// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 runtime for ArkTS — ported from spine38/utils.py（spine-ts 3.8）。
 * 移植期保持与 Python 同名（snake_case），便于与参考实现 diff 比对；数值对齐后可再统一改名。
 */
export class Color {
  r: number
  g: number
  b: number
  a: number

  constructor(r: number = 1.0, g: number = 1.0, b: number = 1.0, a: number = 1.0) {
    this.r = r
    this.g = g
    this.b = b
    this.a = a
  }

  set(r: number, g: number, b: number, a: number): void {
    this.r = r
    this.g = g
    this.b = b
    this.a = a
  }

  static rgba8888(color: Color, value: number): void {
    color.r = ((value & 0xFF000000) >>> 24) / 255.0
    color.g = ((value & 0x00FF0000) >>> 16) / 255.0
    color.b = ((value & 0x0000FF00) >>> 8) / 255.0
    color.a = (value & 0x000000FF) / 255.0
  }

  static rgb888(color: Color, value: number): void {
    color.r = ((value & 0x00FF0000) >>> 16) / 255.0
    color.g = ((value & 0x0000FF00) >>> 8) / 255.0
    color.b = (value & 0x000000FF) / 255.0
  }
}

export function deg_to_rad(deg: number): number {
  return deg * Math.PI / 180.0
}

export function rad_to_deg(rad: number): number {
  return rad * 180.0 / Math.PI
}

export class Curves {
  static readonly LINEAR: number = 0
  static readonly STEPPED: number = 1
  static readonly BEZIER: number = 2

  // curves 数组布局由 loader 写入（每帧 19-float 块），此处只按布局求值
  static apply(curves: number[], index: number, time: number): number {
    let curveType: number = curves[index]
    if (curveType === Curves.LINEAR) {
      return time
    }
    if (curveType === Curves.STEPPED) {
      return 0.0
    }
    // Bezier
    let x: number = time
    let lo: number = 0.0
    let hi: number = 1.0
    let px: number = curves[index + 1]
    let py: number = curves[index + 2]
    let cx1: number = curves[index + 3]
    let cy1: number = curves[index + 4]
    let cx2: number = curves[index + 5]
    let cy2: number = curves[index + 6]
    let t: number = 0.5
    let mt: number = 0.5
    for (let i = 0; i < 8; i++) {
      let mid: number = (lo + hi) / 2
      t = mid
      mt = 1 - t
      let bx: number = mt * mt * mt * px + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t
      if (bx < x) {
        lo = mid
      } else {
        hi = mid
      }
    }
    t = (lo + hi) / 2
    mt = 1 - t
    return mt * mt * mt * py + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * py
  }
}
