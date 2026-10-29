import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";

export type LogicalRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type MonitorLike = {
  scaleFactor: number;
  workArea: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  };
};

function toLogicalRect(monitor: MonitorLike): LogicalRect | null {
  const scale =
    Number.isFinite(monitor.scaleFactor) && monitor.scaleFactor > 0
      ? monitor.scaleFactor
      : 1;
  const left = monitor.workArea.position.x / scale;
  const top = monitor.workArea.position.y / scale;
  const width = monitor.workArea.size.width / scale;
  const height = monitor.workArea.size.height / scale;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, right: left + width, bottom: top + height };
}

export async function getLogicalWorkArea(): Promise<LogicalRect | null> {
  try {
    const current = await currentMonitor();
    if (current) {
      const rect = toLogicalRect(current);
      if (rect) return rect;
    }
  } catch {
    // fall through to primary
  }

  try {
    const primary = await primaryMonitor();
    if (primary) return toLogicalRect(primary);
  } catch {
    // caller falls back to screen metrics
  }

  return null;
}
