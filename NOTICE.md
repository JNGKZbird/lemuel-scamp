# 版权、运行时许可与分发声明

本文件说明 Lemuel Scamp 仓库中不同部分的授权边界。**本仓库不是单一许可证项目**：原创代码、Spine 运行时、内置字体与游戏素材适用不同条款。

## 1. 项目自身代码（Apache-2.0）

本仓库中由本项目原创、且不位于 `src/spine38/` 的代码，采用 [Apache License 2.0](LICENSE)。版权行：

```text
Copyright 2026 JNGKZbird & Contributors
```

`package.json`、`src-tauri/Cargo.toml` 与安装包元数据中的 `license` 字段均指这部分原创代码。

## 2. Spine Runtimes（`src/spine38/`，非 Apache-2.0）

`src/spine38/` 是 Esoteric Software 的 Spine Runtimes（spine-ts 3.8）在本项目中的衍生/集成实现，与予愿安洁莉娜项目的 `spine38/` 同源。该目录整体按 **[Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)** 使用，**不是 Apache-2.0**。

本项目持有有效的 **Spine Editor 许可（Spine Essential）**，并按 **[Spine Editor License Agreement 第 2 节](https://esotericsoftware.com/spine-editor-license)** 将 Spine Runtimes 集成进本产品。

随仓库提供的官方许可原文：

- [LICENSES/Spine-Runtimes-License-3.8.txt](LICENSES/Spine-Runtimes-License-3.8.txt) — spine-ts 3.8 随附的 2019-05-01 版许可
- [LICENSES/Spine-Runtimes-License-2025.txt](LICENSES/Spine-Runtimes-License-2025.txt) — 2025-04-05 版（Spine Editor License Agreement 的 Exhibit A）

### 终端用户与第三方

- **终端用户**：因为本项目按 Spine Editor License Agreement 第 2 节集成，直接使用本软件（不修改代码）不需要购买 Spine。
- **第三方原样分发**：仅原样分发、不做任何修改时，不需要自己的 Spine Editor 许可；但分发材料中必须保留 2025 版许可原文（Exhibit A）。
- **第三方修改 / 适配 / 衍生**：修改、适配或衍生包含 Spine Runtimes 的代码或产品，需要自己的 Spine Editor 许可。
- **关系边界**：本项目与 Esoteric Software 没有官方合作或背书关系；本项目持有的是标准 Spine Editor 许可，不代表 Esoteric Software 对本项目背书。

## 3. 内置字体（HarmonyOS Sans，非 Apache-2.0）

`src/assets/fonts/` 内置 HarmonyOS Sans SC，取自华为官方 HarmonyOS Sans 5.0.1 安装包中的可变字体文件 `HarmonyOS_Sans_SC.ttf`，**未作任何修改**。版权归华为所有，按 HarmonyOS Sans 字体许可使用。许可原文见 [LICENSES/HarmonyOS-Sans-Fonts-License.txt](LICENSES/HarmonyOS-Sans-Fonts-License.txt)。字体仅作为界面显示资源随软件分发，不单独售卖，也不改变其原始许可。

## 4. 与予愿安洁莉娜的关系

本项目的 `src/spine38/` 与予愿安洁莉娜项目的 `spine38/` 同源，二者均衍生自官方 spine-ts 3.8。

予愿安洁莉娜中位于 `spine38/` 之外的原创代码采用 MIT（Copyright (c) 2026 AstrariaX & Contributors）。**本仓库未复制该部分代码**；其 MIT 原文仅作来源说明收录于 [LICENSES/MIT-YuYuan.txt](LICENSES/MIT-YuYuan.txt)，不覆盖本仓库。

本作是独立的 Windows/Tauri 实现，不属于予愿安洁莉娜的 Windows / HarmonyOS / Android 三端。

## 5. 游戏素材（非开源，不随本仓库分发）

游戏素材（Spine 模型、骨骼、贴图、语音、角色图标、头像等）版权归上海鹰角网络有限公司所有，**不适用 Apache-2.0、Spine Runtimes License 或字体许可**，也不随本仓库分发。

运行所需素材由单独的档案库分发：

<https://github.com/JNGKZbird/Arknights-Desktop-Pets-Archive>

素材仅供个人非商业使用；不得用于商业用途，不得损害版权方利益。如权利方提出要求，仓库所有者应停止分发并删除相关内容。

## 6. 非官方声明

本项目是非官方粉丝作品，与上海鹰角网络有限公司无关，不使用官方标识，也不代表官方授权、合作或认可。

## 7. 第三方依赖

npm 与 Cargo 依赖各自保留其原始许可证；本仓库的 Apache-2.0 不改变这些依赖的许可。
