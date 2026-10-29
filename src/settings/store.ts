import { LazyStore } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type CharKey = "angel" | "angel2";
export type Gear = "quiet" | "standard" | "active";
export type ConsoleTheme = "white" | "black";
export type ConsoleMaterial = "classic" | "liquid";
export type AppLanguage = "zh-CN" | "en";
export type PetMode = "gear" | "time";
// 覆盖层动画帧率上限。unlimited = 跟随显示器刷新率（rAF 原速）。
export type FrameRate = "30" | "60" | "120" | "unlimited";
export type GeoLocation = { lat: number; lon: number; isDefault: boolean };
export type VirtualTime = { date: string | null; minute: number | null };

const BEIJING: GeoLocation = {
  lat: 39.9042,
  lon: 116.4074,
  isDefault: true,
};

const store = new LazyStore("settings.json", { autoSave: false });

const SCHEMA_VERSION_KEY = "schemaVersion";
const CONSOLE_THEME_KEY = "console.theme";
const CONSOLE_MATERIAL_KEY = "console.material";
const LANGUAGE_KEY = "app.language";
const LANGUAGE_EVENT = "app-language-changed";
const INTERACTION_OUTLINE_KEY = "interaction.outline";
const INTERACTION_ICE_GLIDE_KEY = "interaction.iceGlide";
const GEAR_EVENT = "gear-changed";
const VISIBILITY_EVENT = "character-visibility-changed";
const OUTLINE_EVENT = "interaction-outline-changed";
const ICE_GLIDE_EVENT = "interaction-ice-glide-changed";
const FRAME_RATE_KEY = "app.frameRate";
const FRAME_RATE_EVENT = "app-frame-rate-changed";
const MODE_KEY = "time.mode";
const LOCATION_KEY = "time.location";
const VIRTUAL_TIME_KEY = "time.virtual";
const MODE_EVENT = "time-mode-changed";
const LOCATION_EVENT = "time-location-changed";
const VIRTUAL_TIME_EVENT = "virtual-time-changed";

const gearKey = (char: CharKey) => `characters.${char}.gear`;
const visibleKey = (char: CharKey) => `characters.${char}.visible`;
const legacyGearKey = (char: CharKey) => `pet-gear-${char}`;

function normalizeGear(value: unknown): Gear {
  return value === "quiet" || value === "active" ? value : "standard";
}

function normalizeVisible(value: unknown): boolean {
  return value !== false;
}

function normalizeOutline(value: unknown): boolean {
  return value !== false;
}

// 溜冰惯性默认关闭：保持现有干脆的冲刺收步，由用户主动开启。
function normalizeIceGlide(value: unknown): boolean {
  return value === true;
}

function normalizeMode(value: unknown): PetMode {
  return value === "time" ? "time" : "gear";
}

// 默认 60：全屏透明覆盖层每帧都要重新合成，60Hz 已足够顺滑，也算功耗最省的一档。
function normalizeFrameRate(value: unknown): FrameRate {
  return value === "30" || value === "120" || value === "unlimited"
    ? value
    : "60";
}

function normalizeLanguage(value: unknown): AppLanguage | null {
  return value === "en" || value === "zh-CN" ? value : null;
}

function normalizeLocation(value: unknown): GeoLocation {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      return { lat, lon, isDefault: false };
    }
  }
  return { ...BEIJING };
}

function normalizeVirtualTime(value: unknown): VirtualTime | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const date = typeof record.date === "string" ? record.date : null;
  const rawMinute = Number(record.minute);
  const minute = Number.isFinite(rawMinute)
    ? Math.min(1439, Math.max(0, Math.round(rawMinute)))
    : null;
  if (date === null && minute === null) return null;
  return { date, minute };
}

async function persist(key: string, value: unknown): Promise<void> {
  // 多窗口共用一份 JSON：先取磁盘最新值，避免本窗口旧缓存整文件覆盖其他窗口的改动
  await store.reload({ ignoreDefaults: true });
  await store.set(key, value);
  await store.save();
}

let initPromise: Promise<void> | null = null;

async function doInit(): Promise<void> {
  await store.init();

  const version = await store.get<number>(SCHEMA_VERSION_KEY);
  if (version === undefined) await store.set(SCHEMA_VERSION_KEY, 1);

  for (const char of ["angel", "angel2"] as const) {
    const current = await store.get<string>(gearKey(char));
    if (current === "quiet" || current === "standard" || current === "active") continue;
    const legacy = localStorage.getItem(legacyGearKey(char));
    await store.set(gearKey(char), normalizeGear(legacy));
  }

  await store.save().catch(() => {});
}

export function initSettings(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// 跨窗口对账用：从磁盘重读本窗口缓存。plugin-store 的 reload 不会触发 change 事件。
export async function reloadSettingsFromDisk(): Promise<void> {
  await initSettings();
  await store.reload({ ignoreDefaults: true });
}

export async function getGear(char: CharKey): Promise<Gear> {
  await initSettings();
  return normalizeGear(await store.get<string>(gearKey(char)));
}

export async function setGear(char: CharKey, gear: Gear): Promise<void> {
  await initSettings();
  await persist(gearKey(char), gear);
  // plugin-store 的 onKeyChange 按窗口 resourceId 过滤，跨窗广播需走 Tauri 事件。
  if (isTauri()) await emit(GEAR_EVENT, { char, gear });
}

export async function subscribeGear(
  char: CharKey,
  cb: (gear: Gear) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<string>(gearKey(char), (value) =>
    cb(normalizeGear(value)),
  );
  const unlistenEvent = await listen<{ char: CharKey; gear: Gear }>(
    GEAR_EVENT,
    (event) => {
      if (event.payload.char === char) cb(normalizeGear(event.payload.gear));
    },
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getCharacterVisible(char: CharKey): Promise<boolean> {
  await initSettings();
  return normalizeVisible(await store.get<unknown>(visibleKey(char)));
}

export async function setCharacterVisible(
  char: CharKey,
  visible: boolean,
): Promise<void> {
  await initSettings();
  await persist(visibleKey(char), visible);
  if (isTauri()) await emit(VISIBILITY_EVENT, { char, visible });
}

export async function subscribeCharacterVisible(
  char: CharKey,
  cb: (visible: boolean) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(
    visibleKey(char),
    (value) => cb(normalizeVisible(value)),
  );
  const unlistenEvent = await listen<{ char: CharKey; visible: boolean }>(
    VISIBILITY_EVENT,
    (event) => {
      if (event.payload.char === char) cb(normalizeVisible(event.payload.visible));
    },
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getInteractionOutline(): Promise<boolean> {
  await initSettings();
  return normalizeOutline(await store.get<unknown>(INTERACTION_OUTLINE_KEY));
}

export async function setInteractionOutline(enabled: boolean): Promise<void> {
  await initSettings();
  await persist(INTERACTION_OUTLINE_KEY, enabled);
  if (isTauri()) await emit(OUTLINE_EVENT, { enabled });
}

export async function subscribeInteractionOutline(
  cb: (enabled: boolean) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(
    INTERACTION_OUTLINE_KEY,
    (value) => cb(normalizeOutline(value)),
  );
  const unlistenEvent = await listen<{ enabled: boolean }>(
    OUTLINE_EVENT,
    (event) => cb(normalizeOutline(event.payload.enabled)),
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getInteractionIceGlide(): Promise<boolean> {
  await initSettings();
  return normalizeIceGlide(await store.get<unknown>(INTERACTION_ICE_GLIDE_KEY));
}

export async function setInteractionIceGlide(
  enabled: boolean,
): Promise<void> {
  await initSettings();
  await persist(INTERACTION_ICE_GLIDE_KEY, enabled);
  if (isTauri()) await emit(ICE_GLIDE_EVENT, { enabled });
}

export async function subscribeInteractionIceGlide(
  cb: (enabled: boolean) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(
    INTERACTION_ICE_GLIDE_KEY,
    (value) => cb(normalizeIceGlide(value)),
  );
  const unlistenEvent = await listen<{ enabled: boolean }>(
    ICE_GLIDE_EVENT,
    (event) => cb(normalizeIceGlide(event.payload.enabled)),
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getMode(): Promise<PetMode> {
  await initSettings();
  return normalizeMode(await store.get<string>(MODE_KEY));
}

export async function setMode(mode: PetMode): Promise<void> {
  await initSettings();
  await persist(MODE_KEY, mode);
  if (isTauri()) await emit(MODE_EVENT, { mode });
}

export async function subscribeMode(
  cb: (mode: PetMode) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<string>(MODE_KEY, (value) =>
    cb(normalizeMode(value)),
  );
  const unlistenEvent = await listen<{ mode: PetMode }>(MODE_EVENT, (event) => {
    cb(normalizeMode(event.payload.mode));
  });
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getVirtualTime(): Promise<VirtualTime | null> {
  await initSettings();
  return normalizeVirtualTime(await store.get<unknown>(VIRTUAL_TIME_KEY));
}

export async function setVirtualTime(
  value: VirtualTime | null,
): Promise<void> {
  await initSettings();
  const normalized = normalizeVirtualTime(value);
  await persist(VIRTUAL_TIME_KEY, normalized);
  if (isTauri()) await emit(VIRTUAL_TIME_EVENT, normalized);
}

export async function subscribeVirtualTime(
  cb: (value: VirtualTime | null) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(
    VIRTUAL_TIME_KEY,
    (value) => cb(normalizeVirtualTime(value)),
  );
  const unlistenEvent = await listen<VirtualTime | null>(
    VIRTUAL_TIME_EVENT,
    (event) => cb(normalizeVirtualTime(event.payload)),
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getLocation(): Promise<GeoLocation> {
  await initSettings();
  return normalizeLocation(await store.get<unknown>(LOCATION_KEY));
}

export async function setLocation(lat: number, lon: number): Promise<void> {
  await initSettings();
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw new RangeError(`invalid location: ${lat}, ${lon}`);
  }
  await persist(LOCATION_KEY, { lat, lon });
  if (isTauri()) await emit(LOCATION_EVENT, { lat, lon });
}

export async function subscribeLocation(
  cb: (location: GeoLocation) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(LOCATION_KEY, (value) =>
    cb(normalizeLocation(value)),
  );
  const unlistenEvent = await listen<{ lat: number; lon: number }>(
    LOCATION_EVENT,
    (event) => cb(normalizeLocation(event.payload)),
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getLanguage(): Promise<AppLanguage | null> {
  await initSettings();
  return normalizeLanguage(await store.get<unknown>(LANGUAGE_KEY));
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  await initSettings();
  await persist(LANGUAGE_KEY, lang);
  if (isTauri()) await emit(LANGUAGE_EVENT, { lang });
}

export async function subscribeLanguage(
  cb: (lang: AppLanguage) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(LANGUAGE_KEY, (value) => {
    const normalized = normalizeLanguage(value);
    if (normalized !== null) cb(normalized);
  });
  const unlistenEvent = await listen<{ lang: AppLanguage }>(
    LANGUAGE_EVENT,
    (event) => {
      const normalized = normalizeLanguage(event.payload.lang);
      if (normalized !== null) cb(normalized);
    },
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getFrameRate(): Promise<FrameRate> {
  await initSettings();
  return normalizeFrameRate(await store.get<unknown>(FRAME_RATE_KEY));
}

export async function setFrameRate(rate: FrameRate): Promise<void> {
  await initSettings();
  await persist(FRAME_RATE_KEY, normalizeFrameRate(rate));
  if (isTauri()) await emit(FRAME_RATE_EVENT, { rate });
}

export async function subscribeFrameRate(
  cb: (rate: FrameRate) => void,
): Promise<UnlistenFn> {
  await initSettings();
  const unlistenStore = await store.onKeyChange<unknown>(
    FRAME_RATE_KEY,
    (value) => cb(normalizeFrameRate(value)),
  );
  const unlistenEvent = await listen<{ rate: FrameRate }>(
    FRAME_RATE_EVENT,
    (event) => cb(normalizeFrameRate(event.payload.rate)),
  );
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}

export async function getConsoleTheme(): Promise<ConsoleTheme> {
  await initSettings();
  return (await store.get<string>(CONSOLE_THEME_KEY)) === "black" ? "black" : "white";
}

export async function setConsoleTheme(theme: ConsoleTheme): Promise<void> {
  await initSettings();
  await persist(CONSOLE_THEME_KEY, theme);
}

export async function getConsoleMaterial(): Promise<ConsoleMaterial> {
  await initSettings();
  return (await store.get<string>(CONSOLE_MATERIAL_KEY)) === "liquid"
    ? "liquid"
    : "classic";
}

export async function setConsoleMaterial(
  material: ConsoleMaterial,
): Promise<void> {
  await initSettings();
  await persist(CONSOLE_MATERIAL_KEY, material);
}

export async function subscribeConsoleTheme(
  cb: (theme: ConsoleTheme) => void,
): Promise<UnlistenFn> {
  await initSettings();
  return store.onKeyChange<string>(CONSOLE_THEME_KEY, (value) =>
    cb(value === "black" ? "black" : "white"),
  );
}
