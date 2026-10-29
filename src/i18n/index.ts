import { useCallback, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { AppLanguage } from "../settings/store";
import type { PhaseId } from "../pet/solar";
import type { SeasonId } from "../pet/season";
import { en, zh } from "./messages";
import type { MessageKey } from "./messages";

export type Lang = AppLanguage;
export type { MessageKey };
export { en, zh };

export const PHASE_MESSAGE_KEYS: Record<PhaseId, MessageKey> = {
  lateNight: "phase.lateNight",
  dawn: "phase.dawn",
  day: "phase.day",
  noon: "phase.noon",
  evening: "phase.evening",
  night: "phase.night",
  polarActive: "phase.polarActive",
  polarQuiet: "phase.polarQuiet",
};

export const SEASON_MESSAGE_KEYS: Record<SeasonId, MessageKey> = {
  spring: "season.spring",
  summer: "season.summer",
  autumn: "season.autumn",
  winter: "season.winter",
};

// WebGL 失败原因来自渲染器内部；英文界面下做一次已知文案映射，
// 未知原因保留原文，方便排障。
const GLOBE_ERROR_EN: Record<string, string> = {
  "WebGL 不可用": "WebGL is unavailable",
  "着色器初始化失败": "Shader initialization failed",
  "顶点缓冲创建失败": "Failed to create the vertex buffer",
  "顶点属性缺失": "Missing vertex attributes",
  "着色器参数缺失": "Missing shader parameters",
  "WebGL 上下文丢失": "WebGL context lost",
  "WebGL 初始化失败": "WebGL initialization failed",
};

export function detectLanguage(): Lang {
  if (
    typeof navigator !== "undefined" &&
    /^zh(?:-|$)/i.test(navigator.language)
  ) {
    return "zh-CN";
  }
  return "en";
}

let current: Lang = detectLanguage();
const listeners = new Set<() => void>();

function applyDocumentLanguage(): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
}

applyDocumentLanguage();

export function getLanguage(): Lang {
  return current;
}

function subscribeLocal(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function setLanguageLocal(next: Lang): void {
  if (current === next) return;
  current = next;
  applyDocumentLanguage();
  for (const listener of listeners) listener();
}

export function translate(
  lang: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = (lang === "en" ? en : zh)[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function localizeGlobeError(reason: string, lang: Lang): string {
  return lang === "en" ? (GLOBE_ERROR_EN[reason] ?? reason) : reason;
}

// 每个窗口调用一次：读取已保存的语言，并订阅其他窗口的切换事件。
let initPromise: Promise<void> | null = null;

export function initLanguage(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      applyDocumentLanguage();
      if (!isTauri()) return;
      const store = await import("../settings/store");
      await store.initSettings();
      const stored = await store.getLanguage();
      if (stored !== null) setLanguageLocal(stored);
      await store.subscribeLanguage((next) => setLanguageLocal(next));
      // 订阅建立前若另一个窗口刚切过语言，事件会丢失；从磁盘补读一次对账。
      await store.reloadSettingsFromDisk();
      const latest = await store.getLanguage();
      if (latest !== null) setLanguageLocal(latest);
    })().catch((err) => {
      console.error("[i18n] init", err);
    });
  }
  return initPromise;
}

export async function changeLanguage(lang: Lang): Promise<void> {
  setLanguageLocal(lang);
  if (!isTauri()) return;
  try {
    const store = await import("../settings/store");
    await store.setLanguage(lang);
  } catch (err) {
    console.error("[i18n] save language", err);
  }
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribeLocal, getLanguage, getLanguage);
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(lang, key, vars),
    [lang],
  );
  return { lang, t, setLanguage: changeLanguage };
}
