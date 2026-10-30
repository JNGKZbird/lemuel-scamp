# Lemuel Scamp · Exusiai / Exusiai the New Covenant

**English** · [简体中文](README.md)

**An unofficial open-source Arknights desktop pet · Windows desktop · v0.1.0 Preview · Built on the same tech stack as [Arknights-Angelina-Pet-YuYuan](https://github.com/JNGKZbird/Arknights-Angelina-Pet-YuYuan)**

**Author**: JNGKZbird

## Abstract

Lemuel Scamp is an unofficial open-source Arknights desktop pet for Windows: Exusiai and her alter Exusiai the New Covenant live on one screen, each with independent movement, visibility, and activity level (Quiet / Standard / Active). By default they walk, sit, and nap on their own according to their gear; switch the console to Virtual Globe and their day is driven by the configured location's solar position, daylight, and polar day/night (the globe page shows the moon phase; the moon does not drive behavior). Right-click either pet to open the menu and choose Interaction: WASD takeover, Shift sprint, and F to poke the other pet within 80 px; ice-glide inertia is off by default and can be enabled in the console. The interface supports Simplified Chinese and English. Built on a Spine 3.8 runtime ported from the official spine-ts 3.8 plus a self-made WebGL renderer, Tauri v2 + React 19. Voice, LLM dialogue, Agent behaviors, a rhythm mode and extra skins are roadmap items, not in this preview.

**Keywords**: Arknights, desktop pet, Lemuel Scamp, Exusiai, Exusiai the New Covenant, Spine 3.8, virtual globe, Tauri, Windows, Apache-2.0.

> Preview status: the program runs; on first launch it opens the asset installer, which downloads and verifies an asset pack from GitHub Releases. Character and Spine assets are not distributed with this repository. This work is not affiliated with the copyright holder of Arknights.

## Preview

![Two pets in interaction mode](media/interaction.png)

## What they can do

- **Two operators on one screen**: Exusiai and Exusiai the New Covenant each have their own activity level, position, and visibility; they share the same time and location.
- **Independent daily life**: by default they walk, sit, and nap according to the Quiet / Standard / Active gear; the gear only changes the pace, and the activity area is always the current monitor's work area (excluding the taskbar).
- **Virtual Globe routine**: daylight, sunrise/sunset, polar day/night, and seasonal noon naps are computed from the configured latitude and longitude; a day is split into six phases, each with its own behavior schedule. The globe page shows the moon phase, which is display-only.
- **Interaction takeover**: right-click either pet to open the menu and choose Interaction; move with WASD, sprint with Shift, and poke the other pet within 80 px with F. Esc leaves Interaction and returns to the current behavior mode.
- **Bilingual UI**: the console's General settings switch between Simplified Chinese and English; the console, globe page, day rail, and context menu follow immediately.
- **Desktop form**: a transparent, borderless, always-on-top overlay; empty areas are click-through and it does not take a taskbar slot.

## Controls

| Action | How |
| --- | --- |
| Drag a pet | Press and hold the character, then drag |
| Poke | Short left-click on the character (displacement < 4 px and hold < 600 ms; longer input is treated as a drag) |
| Open the menu | Right-click the character → Open console / Interaction / Hide |
| Interaction movement | WASD |
| Sprint | Shift (ice-glide inertia is off by default; enable it in the console) |
| Poke the other pet | F (in Interaction, when the other pet is within 80 px) |
| Leave Interaction | Esc |
| Show, hide, gear, mode | Console → General settings |
| UI language | Console → General settings → Language |
| Quit | Close the console window (the console is the application; the pets exit with it) |

### Known limitations

- The overlay covers only the current monitor's work area; multiple monitors, mixed DPI, and display hot-plugging are not supported yet.
- Character display height is capped at 252 px, about 11.7% of the screen height on a 4K display.
- There is no tray icon, no global hotkey, and no single-instance guard; if both pets are hidden, only the console can bring them back, and closing the console quits the application.
- No installer and no code signing are provided; build artifacts from source must not be redistributed.
- Voice, LLM dialogue, Agent behaviors, rhythm mode, extra skins, and mobile are roadmap items.

## Two ways to act, one takeover state

1. **Activity gear (default)**: each operator independently chooses Quiet, Standard, or Active and acts on their own.
2. **Virtual Globe (switched in the console)**: both share one location and time and follow the local solar routine, overriding the gears.

"Interaction" is not a third engine; it is a takeover state you can enter at any time: right-click → Interaction, control one pet, and Esc returns to the behavior mode you left.

## Interaction: a base-style takeover

Interaction is modeled on the interaction in Arknights' base: right-click a operator to enter Interaction and walk around freely. When the two are close enough (rendered-content bounding-box gap ≤ 80 px), an "F" prompt appears; pressing F plays the other pet's poke animation. This preview does not include voice yet.

Entering Interaction applies the same yellow outline used in the base (#FFEB04, can be disabled in the console). The official PC client only offers an on-screen virtual joystick, which is awkward with mouse and keyboard; this project uses WASD and Shift instead. After sprinting, if you release the direction keys while the speed is still in the sprint range, the pet glides on for a while — that is ice-glide inertia, off by default and enabled in the console. Esc leaves Interaction and returns to the previous gear or Virtual Globe routine; Interaction only takes over and does not change the gear or mode.

## Virtual Globe

![Virtual Globe: custom location, solar altitude, terminator, and stars on the console's globe page; the button at the lower right returns to my location](media/globe.png)

The Virtual Globe is drawn purely in code: no 3D model files, no Earth texture, and no 3D engine such as three.js. The whole sphere is drawn in a full-screen triangle on one canvas by a self-made WebGL1 fragment shader; the graticule, terminator, sun, and moon are also computed per pixel in the shader, and 1,600 stars are generated in random directions. The star field is regenerated every time the globe page opens. The globe page's own implementation (styles and shaders included) is about 93 KB.

![Day rail: six phases and a customizable virtual time](media/day-rail.png)

- **Virtual sun and moon**: the sun's position, daylight, and the terminator are computed from the local latitude/longitude and time; the moon has its own phase and is display-only.
- **Beijing by default**: 39.9042°N, 116.4074°E, so the pets live on Beijing time. Click the location marker on the globe page to change the latitude and longitude; the setting is saved and used to simulate routines elsewhere.
- **Six phases**: dawn, day, noon, evening, night, and late night, each with its own behavior schedule. Phase boundaries are determined by solar altitude and vary with latitude and date; day is split into morning and afternoon by noon, and late night straddles midnight, so the day rail usually shows eight consecutive blocks but only six phase types.
- **Polar day and night**: when there is no sunrise or sunset, the routine splits into two halves — active 08:00–20:00 and quiet 20:00–08:00, 12 hours each.
- **Day rail**: change the virtual date and time to simulate routines in different seasons; press Reset to return to the computer's current time.
- **Easter egg**: one unnamed star is hidden in the star field for you to find.

Known limitation of this preview: the globe page does not ship coastline data (`public/globe/map.bin` is not in the repository); the sphere, graticule, sun, moon, terminator, and stars render normally. The coastline code path is currently dormant (`ENABLE_COASTLINES = false`); it neither fetches the file nor logs a console warning.

## Run from source

### Prerequisites

- Windows 10/11 x64
- Node.js `^20.19.0` or `>=22.12.0`, pnpm
- Rust stable (MSVC toolchain)
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
- WebView2 Runtime (bundled with Windows 11; may need a separate install on Windows 10)

### Start

```bash
pnpm install
pnpm tauri dev
```

The first launch compiles the Rust native layer and takes a few minutes; later builds are incremental.

### Character assets

Character and Spine assets are not distributed with this repository. **On first launch**, the installer downloads `windows.zip` (975,229 bytes) from the `trickster-assets-v1` release, verifies the archive SHA-256, and extracts it into the application data directory:

```text
%LOCALAPPDATA%\com.jngkzbird.lemuel-scamp\assets\models-v1\
  angel\    6 files
  angel2\   3 files
```

<https://github.com/JNGKZbird/Arknights-Desktop-Pets-Archive/releases/tag/trickster-assets-v1>

If the download fails, the proxy is unavailable, or you are offline, choose "Import the official zip manually" in the installer and select the same `windows.zip`. The file size and SHA-256 must match the built-in values; unofficial packages are rejected and the installed assets are left untouched.

When developing from source (`pnpm tauri dev`), if the files below are present under `public/models`, the program uses them directly and skips the installer; set `LEMUEL_FORCE_ONBOARDING=1` to ignore this development source and force the install flow using the installed directory.

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

Assets are for personal, non-commercial use only; copyright belongs to Shanghai Hypergryph Network Technology Co., Ltd.

### Build

```bash
pnpm build          # type check + frontend build
pnpm tauri build    # build an installer (this preview does not publish build artifacts)
```

`pnpm tauri build` first runs `scripts/check-release-assets.mjs`: if `public/models/` or `dist/models/` is non-empty, the build is refused so that game assets never end up in an installer. The author's machine has both directories populated and is therefore refused; a clean clone has neither and will proceed to packaging — but this preview publishes source only, and build artifacts must not be redistributed. Before publishing a binary, confirm that `NOTICE.md`, `LICENSES/`, and the font/Spine licenses are distributed with it (`bundle.resources` is configured to place them in the installed `licenses/` folder).

## Technology

- Tauri v2 (2.12) + React 19 + TypeScript + Vite 8; Windows WebView2.
- Spine 3.8 skeletal runtime: ported from the official spine-ts 3.8, sharing its lineage with the `spine38` implementation in Arknights-Angelina-Pet-YuYuan; the WebGL renderer is self-made for this project.
- Virtual Globe: one canvas, one full-screen triangle, and a self-made WebGL1 shader draw the sphere, graticule, terminator, and 1,600 stars in real time, with no 3D model, Earth texture, or 3D engine; sun and moon positions come from local astronomical approximations.
- Code size: the repository's source (TypeScript/TSX, styles, and Rust; excluding fonts and game assets) is about 730 KB, of which about 170 KB is the Spine 3.8 runtime and self-made WebGL renderer under `src/spine38/`.
- The runtime reads Spine 3.8 binary `.skel` files and a single atlas page; it does not read Live2D `.moc3`, and it is not a general model importer.
- The product is fixed to two operators and has no model import UI.
- Rendering follows `requestAnimationFrame`; physics runs at a fixed 60 Hz. No fixed frame rate is promised.

## Roadmap (not implemented)

The following are plans, not features of this preview:

- **LLM dialogue system**: build a knowledge base for each of Exusiai and Exusiai the New Covenant on top of the dialogue foundation of Arknights-Angelina-Pet-YuYuan, plus a general knowledge base.
- **More complex Agent behaviors**: the two pets chat with and interact with each other; compete for visual focus on screen; grab the mouse under certain conditions; virtual cursor and virtual keyboard behaviors. Ultimately a simple Harness for the software.
- **Rhythm mode (under consideration)**: each pet has several unique timbres; Exusiai's 808 cowbell sound is already done.
- **More skins (long term)**: three skins for Exusiai and one for Exusiai the New Covenant.
- **Mobile (long term)**: after the Windows preview, HarmonyOS comes first — phone and tablet are designed and released separately, with HarmonyOS leading; Android follows.

## License and provenance

- **Original code of this project**: Apache-2.0, see [LICENSE](LICENSE).
- **`src/spine38/`**: a derivative/integration of the official spine-ts 3.8, used under the Spine Runtimes License and **not Apache-2.0**. This project holds a valid Spine Editor license (Spine Essential); end users do not need to buy one to use the software as-is; third-party redistribution in unmodified form must retain the 2025 license text; modification, adaptation, or derivation requires your own Spine Editor license. The texts are in [LICENSES/](LICENSES/).
- **Bundled font**: HarmonyOS Sans SC (the variable font from Huawei's official 5.0.1 package, unmodified), copyright Huawei, used under the HarmonyOS Sans font license; see [LICENSES/HarmonyOS-Sans-Fonts-License.txt](LICENSES/HarmonyOS-Sans-Fonts-License.txt).
- **Arknights-Angelina-Pet-YuYuan**: its original code outside `spine38/` is MIT; this repository does not copy that code. This work is an independent Windows/Tauri attempt on the same tech stack.
- **Game assets**: Arknights characters, Spine models, textures, and other assets are copyright Shanghai Hypergryph Network Technology Co., Ltd., are not covered by any license above, and are not distributed with this repository; they are for personal, non-commercial use only. If the rights holder requests it, distribution should stop and the content should be removed.
- **Unofficial statement**: this project has no official partnership with or endorsement from Shanghai Hypergryph Network Technology Co., Ltd. or Esoteric Software.

The complete third-party licenses and distribution boundaries are in [NOTICE.md](NOTICE.md).

## Development docs

`docs/` collects research and design records from development, under the project codename "捣蛋鬼计划". The repository tracks only Markdown, SVG, and JSON sources; exported PNG, PDF, and HTML files are not tracked. Old paths and old names in these documents do not represent the current release name.

## Acknowledgements

- [Arknights-Angelina-Pet-YuYuan](https://github.com/JNGKZbird/Arknights-Angelina-Pet-YuYuan): shared Spine 3.8 tech stack and the asset archive.
- [Esoteric Software](https://esotericsoftware.com/): Spine and the official spine-ts runtime.
- [Huawei HarmonyOS Sans](https://developer.huawei.com/): the bundled font.
- Tauri, React, Vite, and the maintainers of every dependency.
