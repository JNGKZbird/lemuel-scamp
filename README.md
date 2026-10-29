# Lemuel Scamp · 蕾缪乐（能天使 / Exusiai）· 小淘气

**明日方舟开源桌宠（非官方）· Arknights desktop pet · Windows 桌面端 · v0.1.0 Preview · [予愿安洁莉娜](https://github.com/JNGKZbird/Arknights-Angelina-Pet-YuYuan) 同源技术栈**

Lemuel Scamp 是一个面向 Windows 的明日方舟开源桌宠（非官方粉丝作品）：能天使与异格「新约能天使」两位干员同屏生活，各自独立移动、显示，也能各自调「偏静 / 标准 / 偏动」三档活跃度。默认按档位自主散步、坐下、打盹；在总控台切到「虚拟地球」后，改由你所在地的实时太阳位置、日照与极昼极夜安排她们的一天（地球页显示月相；月相不驱动作息）。右键任意一只进入「互动」：WASD 接管、Shift 冲刺、F 戳一戳 80px 内的另一只；冰面惯性默认关闭，可在总控台开启。内置移植自官方 spine-ts 3.8 的运行时与自研 WebGL 渲染，Tauri v2 + React 19。

**关键词**：明日方舟、开源桌宠、蕾缪乐、能天使、新约能天使、Spine 3.8、虚拟地球、桌面宠物、Tauri、Windows

> 预览版状态：程序可运行；首次启动的素材安装引导与白名单下载仍在开发中。角色与 Spine 素材不随本仓库分发。本作与《明日方舟》版权方无关。

## 预览

![两只桌宠在 Windows 桌面上](media/desktop.png)

![Lemuel Scamp 总控台](media/console.png)

## 她能做什么

- **两位干员同屏**：能天使与新约能天使各自拥有独立的活跃档位、位置与可见性；共享同一套时间与地点。
- **自主生活**：默认按「偏静 / 标准 / 偏动」三档散步、坐下、打盹；档位只调节奏，活动范围始终是整块屏幕。
- **虚拟地球作息**：按当地经纬度计算太阳位置与日照，处理日出日落、极昼极夜与季节午睡；地球页显示月相，月相只作展示。
- **互动接管**：右键任意一只进入互动，WASD 移动、Shift 冲刺、F 戳一戳 80px 内的另一只；Esc 退出互动，回到当前行为模式。
- **桌面形态**：透明、无边框、置顶覆盖层；空白区域点击穿透，不占任务栏。

## 操作

| 操作 | 方式 |
| --- | --- |
| 拖动桌宠 | 按住角色拖动 |
| 打开菜单 | 右键角色 → 打开主控台 / 互动 / 隐藏 |
| 互动移动 | WASD |
| 冲刺 | Shift（冰面惯性默认关闭，可在总控台开启） |
| 戳另一只 | F（互动中，另一只距离 ≤ 80px） |
| 退出互动 | Esc |
| 显示、隐藏、档位、模式 | 总控台「通用设置」 |

## 两种行动方式，一个接管状态

1. **行为档位（默认）**：每只干员独立选择偏静、标准或偏动，按档位自主行动。
2. **虚拟地球（总控台切换）**：两只共用同一地点与时间，按当地太阳作息行动，覆盖档位。

「互动」不是第三套引擎，而是随时可以进入的接管状态：右键 → 互动，操作其中一只；Esc 退出后回到进入前的行为方式。

## 虚拟地球

- 按当地经纬度计算太阳位置、日出日落与日照时长。
- 支持极昼、极夜的边界情况，以及随季节变化的午睡安排。
- 地球页显示月相、太阳与月亮位置、晨昏线；月相不驱动作息。
- 地点可在总控台设置；默认地点为北京。

预览版的已知限制：地球页暂未附带海岸线数据（`public/globe/map.bin` 不在仓库中），球体、太阳、月亮与晨昏线正常显示，控制台会有一条 `[globe] coastline` 警告。

## 从源码运行

### 前置

- Windows 10/11 x64
- Node.js `^20.19.0` 或 `>=22.12.0`，pnpm
- Rust stable（MSVC 工具链）
- Visual Studio 2022 Build Tools，安装「使用 C++ 的桌面开发」
- WebView2 Runtime（Windows 11 自带；Windows 10 可能需要单独安装）

### 启动

```bash
pnpm install
pnpm tauri dev
```

首次启动会编译 Rust 原生层，需要几分钟；之后是增量编译。

### 角色素材

角色与 Spine 素材不随本仓库分发。运行前把素材放入：

```text
public/models/angel/
  build_char_103_angel.atlas
  build_char_103_angel.png
  build_char_103_angel.skel
  build_char_103_angel_white.atlas
  build_char_103_angel_white.png
  build_char_103_angel_white.skel

public/models/angel2/
  build_char_1041_angel2.atlas
  build_char_1041_angel2.png
  build_char_1041_angel2.skel
```

素材来自同一维护者的档案库。下载 `trickster-assets-v1` Release 中的 `windows.zip`：

<https://github.com/JNGKZbird/Arknights-Desktop-Pets-Archive/releases/tag/trickster-assets-v1>

解压到项目根目录，压缩包内的 `public/models/{angel,angel2}` 会落到上面的位置。素材仅供个人非商业使用，版权归上海鹰角网络有限公司所有。

### 构建

```bash
pnpm build          # 类型检查 + 前端构建
pnpm tauri build    # 构建安装包；当前会被构建守卫拒绝
```

`pnpm tauri build` 会先执行 `scripts/check-release-assets.mjs`。只要 `public/models/` 或 `dist/models/` 非空，构建就会失败——这是为了避免把游戏素材打进安装包。预览版暂不提供安装包。

## 技术

- Tauri v2（2.12）+ React 19 + TypeScript + Vite 8；Windows WebView2。
- Spine 3.8 骨骼解算：移植自官方 spine-ts 3.8，与予愿安洁莉娜的 `spine38` 实现同源；WebGL 渲染器为本项目自研。
- 当前运行时读取 Spine 3.8 二进制 `.skel` 与单图集页；不直接读取 Live2D `.moc3`，也不是通用模型导入器。
- 产品当前固定两位干员，没有模型导入界面。
- 渲染跟随 `requestAnimationFrame`；物理固定 60Hz，不做固定帧率承诺。

## 许可与来源

- **本项目原创代码**：Apache-2.0，见 [LICENSE](LICENSE)。
- **`src/spine38/`**：官方 spine-ts 3.8 的衍生/集成，按 Spine Runtimes License 使用，**不是 Apache-2.0**。本项目持有有效的 Spine Editor 许可（Spine Essential）；终端用户直接使用无需购买；第三方原样分发须保留 2025 版许可原文；修改、适配或衍生需要自己的 Spine Editor 许可。原文见 [LICENSES/](LICENSES/)。
- **内置字体**：HarmonyOS Sans SC（华为官方 5.0.1 安装包中的可变字体，未修改），版权归华为，按 HarmonyOS Sans 字体许可使用；许可见 [LICENSES/HarmonyOS-Sans-Fonts-License.txt](LICENSES/HarmonyOS-Sans-Fonts-License.txt)。
- **予愿安洁莉娜**：其原创、且位于 `spine38/` 之外的代码为 MIT；本仓库未复制该部分代码。本作是独立的 Windows/Tauri 实现，不是予愿安洁莉娜的第四端。
- **游戏素材**：《明日方舟》角色、Spine 模型、贴图等版权归上海鹰角网络有限公司所有，不适用上述任何许可，也不随本仓库分发；仅供个人非商业使用。权利方如提出要求，应停止分发并删除相关内容。
- **非官方声明**：本项目与上海鹰角网络有限公司、Esoteric Software 均无官方合作或背书关系。

完整的第三方许可与分发边界见 [NOTICE.md](NOTICE.md)。

## 开发文档

`docs/` 收录开发期的调研与设计档案，沿用项目代号「捣蛋鬼计划」。仓库只跟踪 Markdown、SVG 与 JSON 源文件；导出的 PNG、PDF、HTML 不跟踪。档案中的旧路径与旧名称不代表当前发布名。

## English

Lemuel Scamp is an unofficial Arknights desktop pet for Windows (v0.1.0 Preview). Exusiai and Exusiai the New Covenant live on one screen with independent movement, visibility, and activity levels (Quiet / Standard / Active). By default they walk, sit, and nap on their own; switch the console to Virtual Globe and their day is driven by your local solar position, daylight, polar day/night, and seasonal noon naps. The globe page shows the moon phase; the moon does not drive behavior. Right-click a pet to enter Interaction: WASD takeover, Shift sprint, and F to poke the other pet within 80 px; ice-glide inertia is off by default and can be enabled in the console. Built on a Spine 3.8 runtime ported from the official spine-ts 3.8 plus a self-made WebGL renderer, Tauri v2 + React 19, for Windows.

**Keywords**: Arknights, desktop pet, Lemuel Scamp, Exusiai, Exusiai the New Covenant, Spine 3.8, virtual globe, Tauri, Windows, Apache-2.0.

## 致谢

- [予愿安洁莉娜](https://github.com/JNGKZbird/Arknights-Angelina-Pet-YuYuan)：同源 Spine 3.8 技术栈与素材档案库。
- [Esoteric Software](https://esotericsoftware.com/)：Spine 与官方 spine-ts 运行时。
- [华为 HarmonyOS Sans](https://developer.harmonyos.com/)：内置字体。
- Tauri、React、Vite 与所有依赖的维护者。
