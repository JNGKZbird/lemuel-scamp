use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewWindow};

#[derive(Default)]
struct HitState {
    map: Mutex<HashMap<String, Vec<[f64; 4]>>>,
    /// 命中框真正变化时自增；轮询线程据此整轮跳过（30 次/秒的推送不再产生任何系统调用）。
    rev: AtomicU64,
}

#[derive(Default)]
struct DragLockState {
    set: Mutex<HashSet<String>>,
    rev: AtomicU64,
}

static PROBE_LOCK: Mutex<()> = Mutex::new(());

/// 接收某个窗口推送的命中矩形（窗口局部 CSS 像素：x, y, w, h）
#[tauri::command]
fn set_hit_boxes(window: WebviewWindow, state: tauri::State<'_, HitState>, boxes: Vec<[f64; 4]>) {
    if let Ok(mut map) = state.map.lock() {
        let label = window.label().to_string();
        // 前端每 33ms 推一次，内容不变时不插入也不抬 rev，轮询线程整轮睡过去。
        if map.get(&label) != Some(&boxes) {
            map.insert(label, boxes);
            state.rev.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
fn set_drag_lock(
    window: WebviewWindow,
    state: tauri::State<'_, DragLockState>,
    locked: bool,
) {
    if let Ok(mut set) = state.set.lock() {
        let label = window.label().to_string();
        let changed = if locked {
            set.insert(label)
        } else {
            set.remove(&label)
        };
        if changed {
            state.rev.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(windows)]
#[tauri::command]
fn raise_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW,
    };

    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 覆盖层创建后必须先调用：打上 WS_EX_TOOLWINDOW 再显示。
/// Chromium 的窗口遮挡判定（NativeWindowOcclusionTrackerWin / IsWindowVisibleAndFullyOpaque）
/// 会直接跳过工具窗口；不加这一位，全屏置顶的覆盖层在下述情况下会被当成
/// 整屏不透明遮挡物：窗口区域为 NULLREGION（没有宠物可见）或 SIMPLEREGION
/// （只有一只宠物）——判定只把 COMPLEXREGION 排除在外，且遮挡矩形取的是
/// GetWindowRect 整窗。结果就是下面的 B 站/浏览器被判为“被遮挡”：画面停止
/// 绘制，声音仍在播放。
#[cfg(windows)]
#[tauri::command]
fn prepare_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW.0 as isize);
    }
    raise_overlay(app)
}

#[cfg(windows)]
fn set_click_through(hwnd: windows::Win32::Foundation::HWND, ignore: bool) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };

    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        ex |= WS_EX_LAYERED.0 as isize;
        if ignore {
            ex |= WS_EX_TRANSPARENT.0 as isize;
        } else {
            ex &= !(WS_EX_TRANSPARENT.0 as isize);
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
        GetWindowLongPtrW(hwnd, GWL_EXSTYLE) == ex
    }
}

/// 把 CSS 像素盒子换算成物理像素矩形；量化到整数像素，逐帧浮点抖动不会触发重设区域。
#[cfg(windows)]
fn boxes_to_px(rects: &[[f64; 4]], scale: f64) -> Vec<[i32; 4]> {
    let mut out = Vec::with_capacity(rects.len());
    for b in rects {
        let x0 = (b[0] * scale).floor() as i32;
        let y0 = (b[1] * scale).floor() as i32;
        let x1 = ((b[0] + b[2]) * scale).ceil() as i32;
        let y1 = ((b[1] + b[3]) * scale).ceil() as i32;
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        out.push([x0, y0, x1, y1]);
    }
    out
}

/// 把窗口裁剪成若干矩形并集（已换算好的物理像素）。
/// 区域之外窗口在系统眼里不存在，鼠标和触屏都会落到下面的窗口。
/// 用窗口区域而不是 WS_EX_TRANSPARENT：后者对触屏同样穿透，
/// 且整套判定依赖 GetCursorPos，触控不会更新那个坐标。
#[cfg(windows)]
fn apply_input_region(hwnd: windows::Win32::Foundation::HWND, rects: &[[i32; 4]]) -> bool {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
    };

    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_invalid() {
            return false;
        }
        for b in rects {
            let part = CreateRectRgn(b[0], b[1], b[2], b[3]);
            if part.is_invalid() {
                continue;
            }
            let _ = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
            let _ = DeleteObject(part.into());
        }
        // 空矩形列表 = 空区域：没有任何可见内容时整窗不参与命中，等价于全穿透。
        // 成功时区域所有权归系统，不能再 DeleteObject。
        let ok = SetWindowRgn(hwnd, Some(region), true) != 0;
        if !ok {
            let _ = DeleteObject(region.into());
        }
        ok
    }
}

/// 临时行为探针：按宠物窗口追加 JSONL 到系统临时目录。
#[tauri::command]
fn append_behavior_probe(label: String, line: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let safe: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let safe = if safe.is_empty() {
        "pet".to_string()
    } else {
        safe
    };
    let dir = std::env::temp_dir().join("troublemaker-behavior");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!("behavior-{safe}.jsonl"));
    let _guard = PROBE_LOCK
        .lock()
        .map_err(|_| "behavior probe lock poisoned".to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| err.to_string())?;
    writeln!(file, "{line}").map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct ConsoleSavedWindow {
    style: isize,
    rect: windows::Win32::Foundation::RECT,
}

#[cfg(windows)]
static CONSOLE_SAVED_WINDOW: Mutex<Option<ConsoleSavedWindow>> = Mutex::new(None);

#[cfg(windows)]
#[derive(Clone, Copy, serde::Serialize)]
struct ConsoleWorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 原生同步最大化：任务栏可见时用工作区（不盖任务栏）；任务栏自动隐藏时
/// 铺满整个显示器，只在任务栏那条边留 1px 触发带，保证鼠标贴边能唤出任务栏。
/// 继续沿用 tauri-apps/tauri#13270 的同步 resize 顺序，避免 WebView2
/// 异步 resize 造成的闪黑/桌面穿透；退出反向恢复。
#[cfg(windows)]
#[tauri::command]
async fn console_set_maximized(
    app: tauri::AppHandle,
    maximized: bool,
) -> Result<Option<ConsoleWorkArea>, String> {
    use std::sync::mpsc;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmFlush, DwmSetWindowAttribute, DWMWA_BORDER_COLOR,
        DWMWA_COLOR_DEFAULT, DWMWA_COLOR_NONE,
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, RedrawWindow, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, RDW_ERASE, RDW_ERASENOW, RDW_INVALIDATE,
        RDW_UPDATENOW,
    };
    use windows::Win32::UI::Shell::{
        SHAppBarMessage, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP,
        ABM_GETSTATE, ABM_GETTASKBARPOS, ABS_AUTOHIDE, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_NOOWNERZORDER, SWP_NOZORDER,
        WS_CAPTION, WS_THICKFRAME,
    };

    let window = app
        .get_webview_window("console")
        .ok_or_else(|| "console window missing".to_string())?;
    let (tx, rx) = mpsc::channel::<Result<Option<ConsoleWorkArea>, String>>();
    let win = window.clone();
    window
        .with_webview(move |webview| {
            let result = (|| -> Result<Option<ConsoleWorkArea>, String> {
                unsafe {
                    let hwnd: HWND = win.hwnd().map_err(|e| e.to_string())?;
                    let controller = webview.controller();
                    let mut container = HWND::default();
                    controller
                        .ParentWindow(&mut container)
                        .map_err(|e| e.to_string())?;

                    if maximized {
                        if CONSOLE_SAVED_WINDOW
                            .lock()
                            .map(|guard| guard.is_some())
                            .unwrap_or(false)
                        {
                            return Ok(None);
                        }

                        let mut rect = RECT::default();
                        GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())?;
                        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                        if let Ok(mut saved) = CONSOLE_SAVED_WINDOW.lock() {
                            *saved = Some(ConsoleSavedWindow { style, rect });
                        }

                        // 原生阴影会留下不可见边距，最大化时关掉，退出再恢复
                        let _ = win.set_shadow(false);

                        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                        let mut info = MONITORINFO::default();
                        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                            return Err("GetMonitorInfoW failed".to_string());
                        }
                        let mut target = info.rcWork;
                        let mut state_data = APPBARDATA::default();
                        state_data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
                        let state =
                            SHAppBarMessage(ABM_GETSTATE, &mut state_data) as u32;
                        if (state & ABS_AUTOHIDE) != 0 {
                            let mut taskbar = APPBARDATA::default();
                            taskbar.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
                            SHAppBarMessage(ABM_GETTASKBARPOS, &mut taskbar);
                            let bar = taskbar.rc;
                            let intersects = info.rcMonitor.left < bar.right
                                && info.rcMonitor.right > bar.left
                                && info.rcMonitor.top < bar.bottom
                                && info.rcMonitor.bottom > bar.top;
                            if intersects {
                                // 自动隐藏任务栏：铺满显示器，只在任务栏那条边留 1px 触发带
                                target = info.rcMonitor;
                                match taskbar.uEdge {
                                    ABE_BOTTOM => target.bottom -= 1,
                                    ABE_TOP => target.top += 1,
                                    ABE_LEFT => target.left += 1,
                                    ABE_RIGHT => target.right -= 1,
                                    _ => {}
                                }
                            }
                        }
                        let work = target;
                        let work_x = work.left;
                        let work_y = work.top;
                        let work_w = work.right - work.left;
                        let work_h = work.bottom - work.top;

                        // 1) webview 先按工作区尺寸画完，仍被窗口裁切
                        controller
                            .SetBounds(RECT {
                                left: 0,
                                top: 0,
                                right: work_w,
                                bottom: work_h,
                            })
                            .map_err(|e| e.to_string())?;
                        SetWindowPos(
                            container,
                            None,
                            0,
                            0,
                            work_w,
                            work_h,
                            SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                        .map_err(|e| e.to_string())?;
                        let _ = DwmFlush();
                        let _ = DwmFlush();
                        let _ = DwmFlush();

                        // 2) 一次性同步切换窗口样式与工作区矩形
                        let style_without_frame =
                            style & !((WS_CAPTION.0 | WS_THICKFRAME.0) as isize);
                        SetWindowLongPtrW(hwnd, GWL_STYLE, style_without_frame);
                        SetWindowPos(
                            hwnd,
                            None,
                            work_x,
                            work_y,
                            work_w,
                            work_h,
                            SWP_FRAMECHANGED
                                | SWP_NOCOPYBITS
                                | SWP_NOOWNERZORDER
                                | SWP_NOZORDER
                                | SWP_NOACTIVATE,
                        )
                        .map_err(|e| e.to_string())?;
                        controller
                            .SetBounds(RECT {
                                left: 0,
                                top: 0,
                                right: work_w,
                                bottom: work_h,
                            })
                            .map_err(|e| e.to_string())?;
                        SetWindowPos(
                            container,
                            None,
                            0,
                            0,
                            work_w,
                            work_h,
                            SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                        .map_err(|e| e.to_string())?;
                        let _ = RedrawWindow(
                            Some(hwnd),
                            None,
                            None,
                            RDW_ERASE | RDW_INVALIDATE | RDW_ERASENOW | RDW_UPDATENOW,
                        );
                        let _ = DwmFlush();

                        // Win11 无边框窗口仍会画强调色边框/圆角；最大化时去掉，避免边缘亮线
                        let border = DWMWA_COLOR_NONE;
                        let _ = DwmSetWindowAttribute(
                            hwnd,
                            DWMWA_BORDER_COLOR,
                            &border as *const _ as *const std::ffi::c_void,
                            std::mem::size_of::<u32>() as u32,
                        );
                        let corner = DWMWCP_DONOTROUND;
                        let _ = DwmSetWindowAttribute(
                            hwnd,
                            DWMWA_WINDOW_CORNER_PREFERENCE,
                            &corner as *const _ as *const std::ffi::c_void,
                            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                        );

                        return Ok(Some(ConsoleWorkArea {
                            x: work_x,
                            y: work_y,
                            width: work_w.max(0) as u32,
                            height: work_h.max(0) as u32,
                        }));
                    } else {
                        let saved = CONSOLE_SAVED_WINDOW
                            .lock()
                            .ok()
                            .and_then(|guard| *guard);
                        if let Some(saved) = saved {
                            let width = saved.rect.right - saved.rect.left;
                            let height = saved.rect.bottom - saved.rect.top;
                            let _ = win.set_shadow(true);
                            SetWindowLongPtrW(hwnd, GWL_STYLE, saved.style);
                            SetWindowPos(
                                hwnd,
                                None,
                                saved.rect.left,
                                saved.rect.top,
                                width,
                                height,
                                SWP_FRAMECHANGED | SWP_NOCOPYBITS | SWP_NOOWNERZORDER,
                            )
                            .map_err(|e| e.to_string())?;
                            controller
                                .SetBounds(RECT {
                                    left: 0,
                                    top: 0,
                                    right: width,
                                    bottom: height,
                                })
                                .map_err(|e| e.to_string())?;
                            SetWindowPos(
                                container,
                                None,
                                0,
                                0,
                                width,
                                height,
                                SWP_NOZORDER | SWP_NOACTIVATE,
                            )
                            .map_err(|e| e.to_string())?;
                            let _ = RedrawWindow(
                                Some(hwnd),
                                None,
                                None,
                                RDW_ERASE | RDW_INVALIDATE | RDW_ERASENOW | RDW_UPDATENOW,
                            );
                            let _ = DwmFlush();

                            // 还原窗口化外观
                            let border = DWMWA_COLOR_DEFAULT;
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_BORDER_COLOR,
                                &border as *const _ as *const std::ffi::c_void,
                                std::mem::size_of::<u32>() as u32,
                            );
                            let corner = DWMWCP_DEFAULT;
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE,
                                &corner as *const _ as *const std::ffi::c_void,
                                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                            );

                            if let Ok(mut guard) = CONSOLE_SAVED_WINDOW.lock() {
                                *guard = None;
                            }
                        }
                    }
                    Ok(None)
                }
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.recv().map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(HitState::default())
        .manage(DragLockState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_boxes,
            set_drag_lock,
            raise_overlay,
            prepare_overlay_window,
            console_set_maximized,
            append_behavior_probe
        ])
        .setup(|app| {
            // 初始全穿透：等前端推来命中框后再按需放开
            if let Some(w) = app.get_webview_window("angel2") {
                #[cfg(windows)]
                if let Ok(hwnd) = w.hwnd() {
                    let _ = set_click_through(hwnd, true);
                }
                #[cfg(not(windows))]
                let _ = w.set_ignore_cursor_events(true);
            }
            let handle = app.handle().clone();
            // 窗口区域轮询：把前端推来的盒子当作“当前可见内容”，用 SetWindowRgn 裁剪窗口。
            // 不再读光标、不再改 WS_EX_TRANSPARENT —— 触屏输入根本不会更新光标位置，
            // 而区域是系统级命中测试，鼠标和手指走同一条路。
            thread::spawn(move || {
                // 给线程起个名字，调试器/Process Explorer 里一眼能认出是命中区域轮询。
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::System::Threading::{
                        GetCurrentThread, SetThreadDescription,
                    };
                    let name: Vec<u16> = "hit-region-poll\0".encode_utf16().collect();
                    let _ = SetThreadDescription(
                        GetCurrentThread(),
                        windows::core::PCWSTR(name.as_ptr()),
                    );
                }
                // 窗口句柄、缩放与尺寸缓存：webview_windows()/scale_factor() 每次都要
                // 跟主线程打交道，8ms 一轮地调是本线程烧 16% CPU 的主因。
                #[cfg(windows)]
                struct CachedWindow {
                    label: String,
                    hwnd: isize,
                    scale: f64,
                    width_px: i32,
                    height_px: i32,
                }
                #[cfg(windows)]
                let mut cached: Vec<CachedWindow> = Vec::new();
                // 已生效的区域（物理像素），内容相同就不再碰 SetWindowRgn。
                let mut last: HashMap<String, Vec<[i32; 4]>> = HashMap::new();
                let mut last_rev = u64::MAX;
                let mut last_refresh: Option<Instant> = None;
                loop {
                    thread::sleep(Duration::from_millis(8));
                    let hit = handle.state::<HitState>();
                    let drag = handle.state::<DragLockState>();
                    let rev = hit.rev.load(Ordering::Relaxed) + drag.rev.load(Ordering::Relaxed);
                    // 每 500ms 兜底刷新一次窗口表，捕捉新建/重建的窗口。
                    let refresh_due = last_refresh
                        .map(|t| t.elapsed() >= Duration::from_millis(500))
                        .unwrap_or(true);
                    // 没有任何新内容、也没到刷新点：这一轮什么都不做。
                    if rev == last_rev && !refresh_due {
                        continue;
                    }
                    let boxes_map = match hit.map.lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => continue,
                    };
                    let drag_locks = match drag.set.lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => HashSet::new(),
                    };

                    #[cfg(windows)]
                    {
                        let unknown_label = boxes_map
                            .keys()
                            .any(|k| !cached.iter().any(|c| &c.label == k));
                        if refresh_due || unknown_label {
                            last_refresh = Some(Instant::now());
                            let windows: Vec<WebviewWindow> =
                                handle.webview_windows().into_values().collect();
                            let mut next = Vec::with_capacity(windows.len());
                            for win in windows {
                                let label = win.label().to_string();
                                let Ok(hwnd) = win.hwnd() else { continue };
                                let scale = win.scale_factor().unwrap_or(1.0);
                                let (width_px, height_px) = win
                                    .inner_size()
                                    .map(|s| (s.width as i32, s.height as i32))
                                    .unwrap_or((0, 0));
                                next.push(CachedWindow {
                                    label,
                                    hwnd: hwnd.0 as isize,
                                    scale,
                                    width_px,
                                    height_px,
                                });
                            }
                            // 窗口重建（hwnd 变了）时旧区域已失效，强制重设。
                            for c in &next {
                                if let Some(old) = cached.iter().find(|o| o.label == c.label) {
                                    if old.hwnd != c.hwnd {
                                        last.remove(&c.label);
                                    }
                                }
                            }
                            cached = next;
                        }

                        for win in &cached {
                            // console 是正常交互窗口，永远不裁剪。
                            if win.label == "console" {
                                continue;
                            }
                            let desired = if drag_locks.contains(&win.label) {
                                // 拖拽期间整窗放行：手指/鼠标离开角色也能继续拖，
                                // 同时避免区域更新滞后把被拖的角色切掉一块。
                                vec![[0, 0, win.width_px, win.height_px]]
                            } else {
                                match boxes_map.get(&win.label) {
                                    Some(boxes) => boxes_to_px(boxes, win.scale),
                                    None => Vec::new(),
                                }
                            };
                            if last.get(&win.label) == Some(&desired) {
                                continue;
                            }
                            let hwnd = windows::Win32::Foundation::HWND(
                                win.hwnd as *mut core::ffi::c_void,
                            );
                            if apply_input_region(hwnd, &desired) {
                                last.insert(win.label.clone(), desired);
                            }
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = (&boxes_map, &drag_locks);
                    }
                    last_rev = rev;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 覆盖层 PoC：窗口关闭/销毁即退出整个应用，方便验证进程是否存活。
            if window.label() == "overlay" {
                if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. }
                        | tauri::WindowEvent::Destroyed
                ) {
                    window.app_handle().exit(0);
                }
            }
            // 总控台＝软件本体：关闭它即退出整个应用（桌宠一并退出）。
            // 反过来，关闭桌宠不结束应用——只要总控台还在，进程就继续。
            if window.label() == "console" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
