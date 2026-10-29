// 素材包固定元数据。Phase B 的 Rust 侧会内置同一组常量；两边必须一致。
// 大小用 MiB 显示（975_229 B ≈ 0.93 MiB → “0.9 MB”）。

export const ASSET_PACK = {
  releaseTag: "trickster-assets-v1",
  downloadBytes: 975_229,
  installBytes: 1_397_044,
  fileCount: 9,
} as const;

export function formatMiB(bytes: number, digits = 1): string {
  return `${(bytes / 1_048_576).toFixed(digits)} MB`;
}
