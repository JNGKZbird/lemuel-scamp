import { invoke } from "@tauri-apps/api/core";

// 2026-10-23 A/B：15 分钟稳定性排查期间临时关闭探针，排查完改回 false。
const PROBE_DISABLED = true;

export function isBehaviorProbeEnabled(): boolean {
  if (PROBE_DISABLED) return false;
  try {
    return (
      new URLSearchParams(location.search).has("probe") ||
      localStorage.getItem("troublemaker.behaviorProbe") === "1" ||
      location.port === "1420"
    );
  } catch {
    return false;
  }
}

export function writeBehaviorProbe(label: string, event: unknown): void {
  void invoke("append_behavior_probe", {
    label,
    line: JSON.stringify(event),
  }).catch(() => {});
}
