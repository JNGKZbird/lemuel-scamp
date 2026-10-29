//! First-run asset installer: fixed, verified pack from GitHub Releases.
//!
//! The pack is downloaded by Rust (the release CDN does not send CORS headers),
//! checked against a built-in SHA-256, then unzipped through a strict whitelist
//! into the app-local data dir. Nothing outside `assets/` is touched.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const RELEASE_TAG: &str = "trickster-assets-v1";
const RELEASE_URL: &str =
    "https://github.com/JNGKZbird/Arknights-Desktop-Pets-Archive/releases/download/trickster-assets-v1/windows.zip";
const DOWNLOAD_BYTES: u64 = 975_229;
const INSTALL_BYTES: u64 = 1_397_044;
const PACK_SHA256: &str = "08cedc78254fc3ab4d370d15e7cdf65f98fc415b751a98e33bc9702c267ab87d";
const VERSION_DIR: &str = "models-v1";
const MANIFEST: &str = "installed.json";

/// (path inside the pack after the `public/models/` prefix, bytes, sha256)
const PACK_FILES: [(&str, u64, &str); 9] = [
    (
        "angel/build_char_103_angel.atlas",
        4058,
        "f86f0c5430194ce9db63b461511b100d5e5c3eba5d56d4542998ba1ba76129f7",
    ),
    (
        "angel/build_char_103_angel.png",
        154766,
        "b3844018ca19b7c56c13ebeab7ec06b701f4d477b6912f6da299d3aa6d075e13",
    ),
    (
        "angel/build_char_103_angel.skel",
        81856,
        "55850a5b73f312eb1fa5bc164da42e9baae6545540cd4c0191476196b57caec7",
    ),
    (
        "angel/build_char_103_angel_white.atlas",
        4357,
        "63f963015cd502c014ac799e144d13a54cfa6c065b78baac71c2ab97ba6f3d74",
    ),
    (
        "angel/build_char_103_angel_white.png",
        152223,
        "77a18e61fd7874c336513be5fa49fd4e794885e3522a7edc56d318e26ca2bc85",
    ),
    (
        "angel/build_char_103_angel_white.skel",
        81856,
        "55850a5b73f312eb1fa5bc164da42e9baae6545540cd4c0191476196b57caec7",
    ),
    (
        "angel2/build_char_1041_angel2.atlas",
        21798,
        "ba51ed4b60eca1d59801897a336a442e633d2b29c9abc91c499358a16c34d40b",
    ),
    (
        "angel2/build_char_1041_angel2.png",
        515309,
        "d00a629e8d1f0c9558d517995c848b9041c808d07afbf8b8b7115f84d4e9560d",
    ),
    (
        "angel2/build_char_1041_angel2.skel",
        380821,
        "42d2c519b25da82a697bcfb684adf1d46ccab0d2b4120150bd92eb1730c24071",
    ),
];

pub struct InstallerState {
    cancel: AtomicBool,
    /// 唤醒正卡在 `send()` / `chunk()` 上的下载任务，让取消立即生效。
    cancel_notify: tokio::sync::Notify,
    busy: tauri::async_runtime::Mutex<()>,
}

impl Default for InstallerState {
    fn default() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            cancel_notify: tokio::sync::Notify::new(),
            busy: tauri::async_runtime::Mutex::new(()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallError {
    pub code: &'static str,
    pub detail: String,
}

impl InstallError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatus {
    /// "installed" | "dev" | "missing"
    pub source: &'static str,
    pub models_dir: Option<String>,
    pub version: Option<&'static str>,
    pub download_bytes: u64,
    pub install_bytes: u64,
    pub file_count: usize,
    pub release_tag: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub models_dir: String,
    pub version: &'static str,
    pub files: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "phase")]
enum InstallerEvent {
    Downloading { received: u64, total: u64 },
    Verifying,
    Installing,
}

fn assets_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("assets"))
        .map_err(|err| format!("app local data dir: {err}"))
}

fn version_dir(root: &Path) -> PathBuf {
    root.join(VERSION_DIR)
}

fn nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn sha256_file(path: &Path) -> Result<String, InstallError> {
    let mut file = File::open(path)
        .map_err(|err| InstallError::new("disk", format!("open {}: {err}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|err| InstallError::new("disk", format!("read {}: {err}", path.display())))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex(&hasher.finalize())
}

fn installed_ok(root: &Path) -> bool {
    let manifest = root.join(MANIFEST);
    let Ok(text) = fs::read_to_string(&manifest) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    if value.get("version").and_then(|v| v.as_str()) != Some(RELEASE_TAG) {
        return false;
    }
    // 同一个 tag 也可能被换包：清单里的整包哈希必须与内置常量一致。
    if value.get("sha256").and_then(|v| v.as_str()) != Some(PACK_SHA256) {
        return false;
    }
    // 只查“文件在不在”会把被截断/杀软隔离的素材当成已安装，启动后解析失败
    // 且没有修复入口。9 个文件约 1.4 MB，启动时逐个核对哈希成本可以忽略。
    let dir = version_dir(root);
    PACK_FILES.iter().all(|(rel, _, expected)| {
        sha256_file(&dir.join(rel)).map(|actual| actual == *expected).unwrap_or(false)
    })
}

#[cfg(debug_assertions)]
fn debug_source_enabled() -> bool {
    std::env::var("LEMUEL_FORCE_ONBOARDING")
        .map(|value| value != "1")
        .unwrap_or(true)
}

#[cfg(not(debug_assertions))]
fn debug_source_enabled() -> bool {
    false
}

/// `pnpm tauri dev` runs with cwd = src-tauri; also accept the repo root.
fn dev_models_dir() -> Option<PathBuf> {
    if !debug_source_enabled() {
        return None;
    }
    let cwd = std::env::current_dir().ok()?;
    for candidate in [cwd.join("../public/models"), cwd.join("public/models")] {
        let Ok(canon) = candidate.canonicalize() else {
            continue;
        };
        if PACK_FILES.iter().all(|(rel, ..)| canon.join(rel).is_file()) {
            return Some(canon);
        }
    }
    None
}

#[tauri::command]
pub fn asset_status(app: AppHandle) -> Result<AssetStatus, String> {
    let root = assets_root(&app)?;
    if let Some(dir) = dev_models_dir() {
        return Ok(AssetStatus {
            source: "dev",
            models_dir: Some(dir.to_string_lossy().into_owned()),
            version: None,
            download_bytes: DOWNLOAD_BYTES,
            install_bytes: INSTALL_BYTES,
            file_count: PACK_FILES.len(),
            release_tag: RELEASE_TAG,
        });
    }
    let installed = installed_ok(&root);
    Ok(AssetStatus {
        source: if installed { "installed" } else { "missing" },
        models_dir: installed.then(|| version_dir(&root).to_string_lossy().into_owned()),
        version: installed.then_some(RELEASE_TAG),
        download_bytes: DOWNLOAD_BYTES,
        install_bytes: INSTALL_BYTES,
        file_count: PACK_FILES.len(),
        release_tag: RELEASE_TAG,
    })
}

#[tauri::command]
pub fn installer_cancel(state: tauri::State<'_, InstallerState>) {
    state.cancel.store(true, Ordering::SeqCst);
    // 下载循环可能正 await 在 `send()`/`chunk()` 上；只置标志位要等下一次
    // 数据到达才生效，卡死的连接会一直占住 UI。这里主动唤醒它。
    state.cancel_notify.notify_waiters();
}

#[tauri::command]
pub async fn installer_download(
    window: WebviewWindow,
    state: tauri::State<'_, InstallerState>,
) -> Result<InstallResult, InstallError> {
    let _guard = state.busy.lock().await;
    state.cancel.store(false, Ordering::SeqCst);

    // reqwest 的 async 客户端默认没有超时：代理/网络在中途黑洞时 send() 与
    // chunk() 都可能永远不返回，取消标志也就永远没机会被检查。这里给每个
    // 网络等待加超时，并让取消信号能直接打断等待。
    const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
    const CHUNK_TIMEOUT: Duration = Duration::from_secs(20);

    let client = reqwest::Client::builder()
        .user_agent(format!("lemuel-scamp/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| InstallError::new("network", format!("http client: {err}")))?;
    let mut response = tokio::select! {
        biased;
        _ = state.cancel_notify.notified() => {
            return Err(InstallError::new("cancelled", "download cancelled"));
        }
        result = tokio::time::timeout(CONNECT_TIMEOUT, client.get(RELEASE_URL).send()) => {
            match result {
                Ok(Ok(response)) => response,
                Ok(Err(err)) => {
                    return Err(InstallError::new(
                        "network",
                        format!("GET {RELEASE_URL}\n{err}"),
                    ));
                }
                Err(_) => {
                    return Err(InstallError::new(
                        "network",
                        format!(
                            "GET {RELEASE_URL}\ntimed out after {}s",
                            CONNECT_TIMEOUT.as_secs()
                        ),
                    ));
                }
            }
        }
    };
    if !response.status().is_success() {
        return Err(InstallError::new(
            "network",
            format!("GET {RELEASE_URL}\nHTTP {}", response.status()),
        ));
    }

    let mut bytes: Vec<u8> = Vec::with_capacity(DOWNLOAD_BYTES as usize);
    let mut received: u64 = 0;
    let mut last_emit = Instant::now();
    let _ = window.emit(
        "installer-progress",
        InstallerEvent::Downloading {
            received: 0,
            total: DOWNLOAD_BYTES,
        },
    );
    loop {
        if state.cancel.load(Ordering::SeqCst) {
            return Err(InstallError::new("cancelled", "download cancelled"));
        }
        let chunk = tokio::select! {
            biased;
            _ = state.cancel_notify.notified() => {
                return Err(InstallError::new("cancelled", "download cancelled"));
            }
            result = tokio::time::timeout(CHUNK_TIMEOUT, response.chunk()) => {
                match result {
                    Ok(Ok(Some(chunk))) => chunk,
                    Ok(Ok(None)) => break,
                    Ok(Err(err)) => {
                        return Err(InstallError::new(
                            "network",
                            format!("read body: {err}"),
                        ));
                    }
                    Err(_) => {
                        return Err(InstallError::new(
                            "network",
                            format!(
                                "download stalled: no data for {}s",
                                CHUNK_TIMEOUT.as_secs()
                            ),
                        ));
                    }
                }
            }
        };
        received += chunk.len() as u64;
        // 超长响应一律按完整性失败处理；只多 1 字节时也不能落进下面的
        // “download incomplete”（那会把偏长的包误报成网络不完整）。
        if received > DOWNLOAD_BYTES {
            return Err(InstallError::new(
                "hash_mismatch",
                format!("server sent more than the expected {DOWNLOAD_BYTES} bytes"),
            ));
        }
        bytes.extend_from_slice(&chunk);
        if last_emit.elapsed() >= Duration::from_millis(60) {
            last_emit = Instant::now();
            let _ = window.emit(
                "installer-progress",
                InstallerEvent::Downloading {
                    received,
                    total: DOWNLOAD_BYTES,
                },
            );
        }
    }
    let _ = window.emit(
        "installer-progress",
        InstallerEvent::Downloading {
            received,
            total: DOWNLOAD_BYTES,
        },
    );
    if state.cancel.load(Ordering::SeqCst) {
        return Err(InstallError::new("cancelled", "download cancelled"));
    }
    if received != DOWNLOAD_BYTES {
        return Err(InstallError::new(
            "network",
            format!("download incomplete: {received} / {DOWNLOAD_BYTES} bytes"),
        ));
    }

    let _ = window.emit("installer-progress", InstallerEvent::Verifying);
    let actual = sha256_bytes(&bytes);
    if actual != PACK_SHA256 {
        return Err(InstallError::new(
            "hash_mismatch",
            format!("expected {PACK_SHA256}\nactual   {actual}"),
        ));
    }

    let _ = window.emit("installer-progress", InstallerEvent::Installing);
    install_from_bytes(&window.app_handle().clone(), &bytes)
}

#[tauri::command]
pub async fn installer_install_zip(
    window: WebviewWindow,
    state: tauri::State<'_, InstallerState>,
    path: String,
) -> Result<InstallResult, InstallError> {
    let _guard = state.busy.lock().await;
    state.cancel.store(false, Ordering::SeqCst);

    if !path.to_ascii_lowercase().ends_with(".zip") {
        return Err(InstallError::new(
            "unsafe_archive",
            format!("not a .zip file: {path}"),
        ));
    }
    let meta = fs::metadata(&path)
        .map_err(|err| InstallError::new("disk", format!("open {path}: {err}")))?;
    if meta.len() != DOWNLOAD_BYTES {
        return Err(InstallError::new(
            "hash_mismatch",
            format!("file is {} bytes, expected {DOWNLOAD_BYTES}", meta.len()),
        ));
    }
    let bytes = fs::read(&path)
        .map_err(|err| InstallError::new("disk", format!("read {path}: {err}")))?;

    let _ = window.emit("installer-progress", InstallerEvent::Verifying);
    let actual = sha256_bytes(&bytes);
    if actual != PACK_SHA256 {
        return Err(InstallError::new(
            "hash_mismatch",
            format!("expected {PACK_SHA256}\nactual   {actual}"),
        ));
    }

    let _ = window.emit("installer-progress", InstallerEvent::Installing);
    install_from_bytes(&window.app_handle().clone(), &bytes)
}

#[tauri::command]
pub fn installer_reveal(app: AppHandle) -> Result<(), String> {
    let dir = version_dir(&assets_root(&app)?);
    if !dir.is_dir() {
        return Err("assets are not installed yet".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn installer_restart(app: AppHandle) {
    app.request_restart();
}

fn pack_relative(path: &Path) -> Option<String> {
    let mut comps = path.components();
    let (Some(Component::Normal(a)), Some(Component::Normal(b)), Some(Component::Normal(c)), Some(Component::Normal(d)), None) =
        (
            comps.next(),
            comps.next(),
            comps.next(),
            comps.next(),
            comps.next(),
        )
    else {
        return None;
    };
    if a != "public" || b != "models" {
        return None;
    }
    Some(format!("{}/{}", c.to_str()?, d.to_str()?))
}

fn extract_into(bytes: &[u8], staging: &Path) -> Result<(), InstallError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|err| InstallError::new("unsafe_archive", format!("zip: {err}")))?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut total: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| InstallError::new("unsafe_archive", format!("zip entry: {err}")))?;
        let raw = entry
            .name()
            .map_err(|err| InstallError::new("unsafe_archive", format!("entry name: {err}")))?
            .to_string();
        if entry.is_dir() {
            continue;
        }
        if raw.contains('\\') {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("backslash in entry name: {raw}"),
            ));
        }
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("unsafe entry path: {raw}"),
            ));
        };
        let Some(rel) = pack_relative(&enclosed) else {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("unexpected entry: {raw}"),
            ));
        };
        let Some((_, expected_size, _)) = PACK_FILES
            .iter()
            .find(|(path, ..)| *path == rel.as_str())
        else {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("unknown file: {rel}"),
            ));
        };
        if !seen.insert(rel.clone()) {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("duplicate file: {rel}"),
            ));
        }
        if let Some(mode) = entry.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err(InstallError::new(
                    "unsafe_archive",
                    format!("symlink entry: {rel}"),
                ));
            }
        }
        if entry.size() != *expected_size {
            return Err(InstallError::new(
                "unsafe_archive",
                format!(
                    "{rel}: size {} / expected {expected_size}",
                    entry.size()
                ),
            ));
        }
        total += entry.size();
        if total > INSTALL_BYTES {
            return Err(InstallError::new(
                "unsafe_archive",
                "uncompressed total exceeds the expected size",
            ));
        }

        let dest = staging.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                InstallError::new("disk", format!("mkdir {}: {err}", parent.display()))
            })?;
        }
        let mut out = File::create(&dest).map_err(|err| {
            InstallError::new("disk", format!("create {}: {err}", dest.display()))
        })?;
        let mut buf = [0u8; 64 * 1024];
        let mut written: u64 = 0;
        loop {
            let read = entry
                .read(&mut buf)
                .map_err(|err| InstallError::new("unsafe_archive", format!("read {rel}: {err}")))?;
            if read == 0 {
                break;
            }
            written += read as u64;
            if written > *expected_size {
                return Err(InstallError::new(
                    "unsafe_archive",
                    format!("{rel}: more data than declared"),
                ));
            }
            out.write_all(&buf[..read]).map_err(|err| {
                InstallError::new("disk", format!("write {}: {err}", dest.display()))
            })?;
        }
        if written != *expected_size {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("{rel}: wrote {written} / expected {expected_size} bytes"),
            ));
        }
    }

    if seen.len() != PACK_FILES.len() || total != INSTALL_BYTES {
        return Err(InstallError::new(
            "unsafe_archive",
            format!(
                "pack has {} files / {total} bytes, expected {} / {INSTALL_BYTES}",
                seen.len(),
                PACK_FILES.len()
            ),
        ));
    }
    Ok(())
}

fn verify_installed_files(dir: &Path) -> Result<(), InstallError> {
    for (rel, _, expected) in PACK_FILES {
        let actual = sha256_file(&dir.join(rel))?;
        if actual != expected {
            return Err(InstallError::new(
                "unsafe_archive",
                format!("{rel}: hash {actual}, expected {expected}"),
            ));
        }
    }
    Ok(())
}

fn write_manifest(root: &Path) -> Result<(), InstallError> {
    let mut files = BTreeMap::new();
    for (rel, _, sha) in PACK_FILES {
        files.insert(rel, sha);
    }
    let manifest = serde_json::json!({
        "version": RELEASE_TAG,
        "dir": VERSION_DIR,
        "sha256": PACK_SHA256,
        "downloadBytes": DOWNLOAD_BYTES,
        "installBytes": INSTALL_BYTES,
        "fileCount": PACK_FILES.len(),
        "installedAtUnix": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        "files": files,
    });
    let text = serde_json::to_string_pretty(&manifest)
        .map_err(|err| InstallError::new("disk", format!("manifest: {err}")))?;
    let temp = root.join(format!(".{MANIFEST}.tmp-{}", nonce()));
    fs::write(&temp, text)
        .map_err(|err| InstallError::new("disk", format!("write manifest: {err}")))?;
    fs::rename(&temp, root.join(MANIFEST))
        .map_err(|err| InstallError::new("disk", format!("commit manifest: {err}")))?;
    Ok(())
}

/// 清掉上次安装留下的半成品：staging/old 目录和写了一半的清单文件。
/// 只动 `assets/` 根下自己命名的临时项，不碰 `models-v1`。
fn sweep_stale(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with(".staging-")
            || name.starts_with(".old-")
            || name.starts_with(".installed.json.tmp-"))
        {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
}

fn install_from_bytes(app: &AppHandle, bytes: &[u8]) -> Result<InstallResult, InstallError> {
    let root = assets_root(app).map_err(|err| InstallError::new("disk", err))?;
    fs::create_dir_all(&root)
        .map_err(|err| InstallError::new("disk", format!("mkdir {}: {err}", root.display())))?;
    sweep_stale(&root);

    let stamp = nonce();
    let staging = root.join(format!(".staging-{stamp}"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|err| {
        InstallError::new("disk", format!("mkdir {}: {err}", staging.display()))
    })?;

    let result = (|| -> Result<(), InstallError> {
        extract_into(bytes, &staging)?;
        verify_installed_files(&staging)?;

        let final_dir = version_dir(&root);
        let old_dir = root.join(format!(".old-{stamp}"));
        if final_dir.exists() {
            fs::rename(&final_dir, &old_dir).map_err(|err| {
                InstallError::new("disk", format!("move old install aside: {err}"))
            })?;
        }
        if let Err(err) = fs::rename(&staging, &final_dir) {
            if old_dir.exists() {
                let _ = fs::rename(&old_dir, &final_dir);
            }
            return Err(InstallError::new(
                "disk",
                format!("move install into place: {err}"),
            ));
        }
        // 清单提交成功之前不要销毁旧安装：write_manifest 失败时要把新目录
        // 撤回 staging（由下面的统一清理删掉）、再让旧安装回到原位。
        if let Err(err) = write_manifest(&root) {
            let _ = fs::rename(&final_dir, &staging);
            if old_dir.exists() {
                let _ = fs::rename(&old_dir, &final_dir);
            }
            return Err(err);
        }
        let _ = fs::remove_dir_all(&old_dir);
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;

    Ok(InstallResult {
        models_dir: version_dir(&root).to_string_lossy().into_owned(),
        version: RELEASE_TAG,
        files: PACK_FILES.len(),
    })
}
