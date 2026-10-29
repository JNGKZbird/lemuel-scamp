// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 约束求解 — IK / 变换 / 路径约束，精确移植自 spine38/constraints.py（spine-ts 3.8）。
 * 与 Python 同构（含骨骼与约束交错执行语义）。
 */
import {
  IkConstraintData, TransformConstraintData, PathConstraintData,
  PathAttachment, TRANSFORM_ONLY_TRANSLATION, TRANSFORM_NO_ROTATION_OR_REFLECTION,
  TRANSFORM_NO_SCALE, TRANSFORM_NO_SCALE_OR_REFLECTION,
  SPACING_LENGTH, ROTATE_TANGENT, ROTATE_CHAIN, ROTATE_CHAIN_SCALE
} from './loader'
import { Bone, Skeleton, Slot, compute_mesh_vertices } from './skeleton'

const DEG_RAD = Math.PI / 180.0
const RAD_DEG = 180.0 / Math.PI
const PI = Math.PI
const PI2 = Math.PI * 2

function _atan2(y: number, x: number): number {
  return Math.atan2(y, x)
}

// ── IK 约束 ─────────────────────────────────────────────
export class IkConstraint {
  data: IkConstraintData
  bones: Bone[]
  target: Bone
  mix: number
  softness: number
  bend_direction: number
  compress: boolean
  stretch: boolean
  uniform: boolean
  active: boolean = false

  constructor(data: IkConstraintData, skeleton: Skeleton) {
    this.data = data
    this.bones = []
    for (let i = 0; i < data.bones.length; i++) {
      this.bones.push(skeleton.bones[data.bones[i].index])
    }
    this.target = skeleton.bones[data.target!.index]
    this.mix = data.mix
    this.softness = data.softness
    this.bend_direction = data.bend_direction
    this.compress = data.compress
    this.stretch = data.stretch
    this.uniform = data.uniform
  }

  apply(): void {
    let target = this.target
    let bones = this.bones
    if (bones.length === 1) {
      this._apply1(bones[0], target.world_x, target.world_y, this.compress, this.stretch, this.uniform)
    } else if (bones.length === 2) {
      this._apply2(bones[0], bones[1], target.world_x, target.world_y)
    }
  }

  update(): void {
    this.apply()
  }

  private _apply1(bone: Bone, target_x: number, target_y: number, compress: boolean, stretch: boolean,
    uniform: boolean): void {
    let p = bone.parent!
    if (!bone.applied_valid) {
      bone.update_applied_transform()
    }
    p = bone.parent!
    let pa0 = p.a
    let pb0 = p.b
    let pc0 = p.c
    let pd0 = p.d
    let rotation_ik = -bone.ashear_x - bone.arotation
    let tx = 0.0
    let ty = 0.0
    let mode = bone.data.transform_mode
    if (mode === TRANSFORM_ONLY_TRANSLATION) {
      tx = target_x - bone.world_x
      ty = target_y - bone.world_y
    } else if (mode === TRANSFORM_NO_ROTATION_OR_REFLECTION) {
      let s = Math.abs(pa0 * pd0 - pb0 * pc0) / (pa0 * pa0 + pc0 * pc0)
      let sa = pa0 / bone.skeleton.scale_x
      let sc = pc0 / bone.skeleton.scale_y
      pb0 = -sc * s * bone.skeleton.scale_x
      pd0 = sa * s * bone.skeleton.scale_y
      rotation_ik += _atan2(sc, sa) * RAD_DEG
    } else {
      let x = target_x - p.world_x
      let y = target_y - p.world_y
      let d = pa0 * pd0 - pb0 * pc0
      if (Math.abs(d) < 0.0001) {
        return
      }
      tx = (x * pd0 - y * pb0) / d - bone.ax
      ty = (y * pa0 - x * pc0) / d - bone.ay
    }
    rotation_ik += _atan2(ty, tx) * RAD_DEG
    if (bone.ascale_x < 0) {
      rotation_ik += 180
    }
    if (rotation_ik > 180) {
      rotation_ik -= 360
    } else if (rotation_ik < -180) {
      rotation_ik += 360
    }
    let sx = bone.ascale_x
    let sy = bone.ascale_y
    if (compress || stretch) {
      if (mode === TRANSFORM_NO_SCALE || mode === TRANSFORM_NO_SCALE_OR_REFLECTION) {
        tx = target_x - bone.world_x
        ty = target_y - bone.world_y
      }
      let b = bone.data.length * sx
      let dd = Math.sqrt(tx * tx + ty * ty)
      if (((compress && dd < b) || (stretch && dd > b)) && b > 0.0001) {
        let s = (dd / b - 1) * this.mix + 1
        sx *= s
        if (uniform) {
          sy *= s
        }
      }
    }
    bone._update_with(bone.ax, bone.ay, bone.arotation + rotation_ik * this.mix, sx, sy,
      bone.ashear_x, bone.ashear_y)
  }

  private _apply2(parent: Bone, child: Bone, target_x: number, target_y: number): void {
    if (this.mix === 0) {
      child.update_world_transform()
      return
    }
    if (!parent.applied_valid) {
      parent.update_applied_transform()
    }
    if (!child.applied_valid) {
      child.update_applied_transform()
    }
    let px = parent.ax
    let py = parent.ay
    let psx = parent.ascale_x
    let sx = parent.ascale_x
    let psy = parent.ascale_y
    let csx = child.ascale_x
    let os1 = 0
    let os2 = 0
    let s2 = 0
    if (psx < 0) {
      psx = -psx
      os1 = 180
      s2 = -1
    } else {
      os1 = 0
      s2 = 1
    }
    if (psy < 0) {
      psy = -psy
      s2 = -s2
    }
    if (csx < 0) {
      csx = -csx
      os2 = 180
    } else {
      os2 = 0
    }
    let cx = child.ax
    let cy = 0.0
    let cwx = 0.0
    let cwy = 0.0
    let a = parent.a
    let b = parent.b
    let c = parent.c
    let d = parent.d
    let u = Math.abs(psx - psy) <= 0.0001
    if (!u) {
      cy = 0.0
      cwx = a * cx + parent.world_x
      cwy = c * cx + parent.world_y
    } else {
      cy = child.ay
      cwx = a * cx + b * cy + parent.world_x
      cwy = c * cx + d * cy + parent.world_y
    }
    let pp = parent.parent!
    a = pp.a
    b = pp.b
    c = pp.c
    d = pp.d
    let det = a * d - b * c
    if (Math.abs(det) < 0.0001) {
      return
    }
    let id = 1.0 / det
    let x = cwx - pp.world_x
    let y = cwy - pp.world_y
    let dx = (x * d - y * b) * id - px
    let dy = (y * a - x * c) * id - py
    let l1 = Math.sqrt(dx * dx + dy * dy)
    let l2 = child.data.length * csx
    let a1 = 0.0
    let a2 = 0.0
    if (l1 < 0.0001) {
      // JS: apply1(parent, targetX, targetY, false, stretch, false, alpha)
      this._apply1(parent, target_x, target_y, false, this.stretch, false)
      child._update_with(cx, cy, 0.0, child.ascale_x, child.ascale_y, child.ashear_x, child.ashear_y)
      return
    }
    x = target_x - pp.world_x
    y = target_y - pp.world_y
    let tx = (x * d - y * b) * id - px
    let ty = (y * a - x * c) * id - py
    let dd = tx * tx + ty * ty
    let softness = this.softness
    if (softness !== 0) {
      softness *= psx * (csx + 1) / 2
      let td = Math.sqrt(dd)
      let sd = td - l1 - l2 * psx + softness
      if (sd > 0) {
        let p = Math.min(1.0, sd / (softness * 2)) - 1
        p = (sd - softness * (1 - p * p)) / td
        tx -= p * tx
        ty -= p * ty
        dd = tx * tx + ty * ty
      }
    }
    if (u) {
      l2 *= psx
      let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2)
      if (cos < -1) {
        cos = -1
      } else if (cos > 1) {
        cos = 1
        if (this.stretch) {
          sx *= (Math.sqrt(dd) / (l1 + l2) - 1) * this.mix + 1
        }
      }
      a2 = Math.acos(cos) * this.bend_direction
      a = l1 + l2 * cos
      b = l2 * Math.sin(a2)
      a1 = _atan2(ty * a - tx * b, tx * a + ty * b)
    } else {
      a = psx * l2
      b = psy * l2
      let aa = a * a
      let bb = b * b
      let ta = _atan2(ty, tx)
      let qc = bb * l1 * l1 + aa * dd - aa * bb
      let qc1 = -2 * bb * l1
      let qc2 = bb - aa
      let qd = qc1 * qc1 - 4 * qc2 * qc
      let break_outer = false
      if (qd >= 0) {
        let q = Math.sqrt(qd)
        if (qc1 < 0) {
          q = -q
        }
        q = -(qc1 + q) / 2
        let r0 = q / qc2
        let r1 = qc / q
        let r = Math.abs(r0) < Math.abs(r1) ? r0 : r1
        if (r * r <= dd) {
          let ny = Math.sqrt(dd - r * r) * this.bend_direction
          a1 = ta - _atan2(ny, r)
          a2 = _atan2(ny / psy, (r - l1) / psx)
          break_outer = true
        } else {
          break_outer = false
        }
      } else {
        break_outer = false
      }
      if (!break_outer) {
        let min_angle = PI
        let min_x = l1 - a
        let min_dist = min_x * min_x
        let min_y = 0.0
        let max_angle = 0.0
        let max_x = l1 + a
        let max_dist = max_x * max_x
        let max_y = 0.0
        let nc = Math.abs(aa - bb) > 0.0001 ? -a * l1 / (aa - bb) : 0.0
        if (-1 <= nc && nc <= 1) {
          nc = Math.acos(nc)
          let nx = a * Math.cos(nc) + l1
          let ny = b * Math.sin(nc)
          let nd = nx * nx + ny * ny
          if (nd < min_dist) {
            min_angle = nc
            min_dist = nd
            min_x = nx
            min_y = ny
          }
          if (nd > max_dist) {
            max_angle = nc
            max_dist = nd
            max_x = nx
            max_y = ny
          }
        }
        if (dd <= (min_dist + max_dist) / 2) {
          a1 = ta - _atan2(min_y * this.bend_direction, min_x)
          a2 = min_angle * this.bend_direction
        } else {
          a1 = ta - _atan2(max_y * this.bend_direction, max_x)
          a2 = max_angle * this.bend_direction
        }
      }
    }
    let os = _atan2(cy, cx) * s2
    let rotation = parent.arotation
    a1 = (a1 - os) * RAD_DEG + os1 - rotation
    if (a1 > 180) {
      a1 -= 360
    } else if (a1 < -180) {
      a1 += 360
    }
    parent._update_with(px, py, rotation + a1 * this.mix, sx, parent.ascale_y, 0.0, 0.0)
    rotation = child.arotation
    a2 = ((a2 + os) * RAD_DEG - child.ashear_x) * s2 + os2 - rotation
    if (a2 > 180) {
      a2 -= 360
    } else if (a2 < -180) {
      a2 += 360
    }
    child._update_with(cx, cy, rotation + a2 * this.mix, child.ascale_x, child.ascale_y,
      child.ashear_x, child.ashear_y)
  }
}

// ── 变换约束 ────────────────────────────────────────────
export class TransformConstraint {
  data: TransformConstraintData
  bones: Bone[]
  target: Bone
  rotate_mix: number
  translate_mix: number
  scale_mix: number
  shear_mix: number
  active: boolean = false

  constructor(data: TransformConstraintData, skeleton: Skeleton) {
    this.data = data
    this.bones = []
    for (let i = 0; i < data.bones.length; i++) {
      this.bones.push(skeleton.bones[data.bones[i].index])
    }
    this.target = skeleton.bones[data.target!.index]
    this.rotate_mix = data.rotate_mix
    this.translate_mix = data.translate_mix
    this.scale_mix = data.scale_mix
    this.shear_mix = data.shear_mix
  }

  apply(): void {
    // 本模型数据均为 local=false, relative=false → applyAbsoluteWorld
    this._apply_absolute_world()
  }

  update(): void {
    this.apply()
  }

  private _apply_absolute_world(): void {
    let rotate_mix = this.rotate_mix
    let translate_mix = this.translate_mix
    let scale_mix = this.scale_mix
    let shear_mix = this.shear_mix
    let target = this.target
    let ta = target.a
    let tb = target.b
    let tc = target.c
    let td = target.d
    let deg_rad_reflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD
    let offset_rotation = this.data.offset_rotation * deg_rad_reflect
    let offset_shear_y = this.data.offset_shear_y * deg_rad_reflect
    for (let i = 0; i < this.bones.length; i++) {
      let bone = this.bones[i]
      if (rotate_mix !== 0) {
        let a = bone.a
        let b = bone.b
        let c = bone.c
        let d = bone.d
        let r = _atan2(tc, ta) - _atan2(c, a) + offset_rotation
        if (r > PI) {
          r -= PI2
        } else if (r < -PI) {
          r += PI2
        }
        r *= rotate_mix
        let cos = Math.cos(r)
        let sin = Math.sin(r)
        bone.a = cos * a - sin * c
        bone.b = cos * b - sin * d
        bone.c = sin * a + cos * c
        bone.d = sin * b + cos * d
        bone.applied_valid = false
      }
      if (translate_mix !== 0) {
        // target.localToWorld(offsetX, offsetY)
        let ox = this.data.offset_x
        let oy = this.data.offset_y
        let tx = target.a * ox + target.b * oy + target.world_x
        let ty = target.c * ox + target.d * oy + target.world_y
        bone.world_x += (tx - bone.world_x) * translate_mix
        bone.world_y += (ty - bone.world_y) * translate_mix
        bone.applied_valid = false
      }
      if (scale_mix > 0) {
        let s = Math.sqrt(bone.a * bone.a + bone.c * bone.c)
        let ts = Math.sqrt(ta * ta + tc * tc)
        if (s > 0.00001) {
          s = (s + (ts - s + this.data.offset_scale_x) * scale_mix) / s
        }
        bone.a *= s
        bone.c *= s
        s = Math.sqrt(bone.b * bone.b + bone.d * bone.d)
        ts = Math.sqrt(tb * tb + td * td)
        if (s > 0.00001) {
          s = (s + (ts - s + this.data.offset_scale_y) * scale_mix) / s
        }
        bone.b *= s
        bone.d *= s
        bone.applied_valid = false
      }
      if (shear_mix > 0) {
        let b = bone.b
        let d = bone.d
        let by = _atan2(d, b)
        let r = _atan2(td, tb) - _atan2(tc, ta) - (by - _atan2(bone.c, bone.a))
        if (r > PI) {
          r -= PI2
        } else if (r < -PI) {
          r += PI2
        }
        r = by + (r + offset_shear_y) * shear_mix
        let s = Math.sqrt(b * b + d * d)
        bone.b = Math.cos(r) * s
        bone.d = Math.sin(r) * s
        bone.applied_valid = false
      }
    }
  }
}

// ── 路径约束 ────────────────────────────────────────────
export class PathConstraint {
  static readonly NONE: number = -1
  static readonly BEFORE: number = -2
  static readonly AFTER: number = -3
  static readonly epsilon: number = 0.00001

  data: PathConstraintData
  bones: Bone[]
  target: Slot
  position: number
  spacing: number
  rotate_mix: number
  translate_mix: number
  active: boolean = false
  spaces: number[] = new Array<number>(8).fill(0.0)
  positions: number[] = new Array<number>(8).fill(0.0)
  world: number[] = new Array<number>(8).fill(0.0)
  lengths: number[] = new Array<number>(8).fill(0.0)

  constructor(data: PathConstraintData, skeleton: Skeleton) {
    this.data = data
    this.bones = []
    for (let i = 0; i < data.bones.length; i++) {
      this.bones.push(skeleton.bones[data.bones[i].index])
    }
    this.target = skeleton.slots[data.target!.index]
    this.position = data.position
    this.spacing = data.spacing
    this.rotate_mix = data.rotate_mix
    this.translate_mix = data.translate_mix
  }

  apply(): void {
    this.update()
  }

  update(): void {
    let attachment = this.target.attachment
    if (!(attachment instanceof PathAttachment)) {
      return
    }
    let rotate_mix = this.rotate_mix
    let translate_mix = this.translate_mix
    let translate = translate_mix > 0
    let rotate = rotate_mix > 0
    if (!translate && !rotate) {
      return
    }
    let data = this.data
    let percent_spacing = data.spacing_mode === 2 // Percent
    let rotate_mode = data.rotate_mode
    let tangents = rotate_mode === ROTATE_TANGENT
    let scale = rotate_mode === ROTATE_CHAIN_SCALE
    let bone_count = this.bones.length
    let spaces_count = tangents ? bone_count : bone_count + 1
    let bones = this.bones
    while (this.spaces.length < spaces_count) {
      this.spaces.push(0.0)
    }
    let spaces = this.spaces
    let lengths: number[] | null = null
    let spacing = this.spacing
    if (scale || !percent_spacing) {
      if (scale) {
        while (this.lengths.length < bone_count) {
          this.lengths.push(0.0)
        }
        lengths = this.lengths
      }
      let length_spacing = data.spacing_mode === SPACING_LENGTH
      for (let i = 0; i < spaces_count - 1; i++) {
        let bone = bones[i]
        let setup_length = bone.data.length
        if (setup_length < PathConstraint.epsilon) {
          if (scale) {
            lengths![i] = 0.0
          }
          spaces[i + 1] = 0.0
        } else if (percent_spacing) {
          if (scale) {
            let x = setup_length * bone.a
            let y = setup_length * bone.c
            lengths![i] = Math.sqrt(x * x + y * y)
          }
          spaces[i + 1] = spacing
        } else {
          let x = setup_length * bone.a
          let y = setup_length * bone.c
          let length = Math.sqrt(x * x + y * y)
          if (scale) {
            lengths![i] = length
          }
          spaces[i + 1] = (length_spacing ? (setup_length + spacing) : spacing) * length / setup_length
        }
      }
    } else {
      for (let i = 1; i < spaces_count; i++) {
        spaces[i] = spacing
      }
    }
    let positions = this._compute_world_positions(attachment, spaces_count, tangents,
      data.position_mode === 1, percent_spacing)
    let bone_x = positions[0]
    let bone_y = positions[1]
    let offset_rotation = data.offset_rotation
    let tip = false
    if (offset_rotation === 0) {
      tip = rotate_mode === ROTATE_CHAIN
    } else {
      tip = false
      let p = this.target.bone
      offset_rotation *= p.a * p.d - p.b * p.c > 0 ? DEG_RAD : -DEG_RAD
    }
    for (let i = 0; i < bone_count; i++) {
      let bone = bones[i]
      bone.world_x += (bone_x - bone.world_x) * translate_mix
      bone.world_y += (bone_y - bone.world_y) * translate_mix
      let x = positions[(i + 1) * 3]
      let y = positions[(i + 1) * 3 + 1]
      let dx = x - bone_x
      let dy = y - bone_y
      if (scale) {
        let length = lengths![i]
        if (length !== 0) {
          let s = (Math.sqrt(dx * dx + dy * dy) / length - 1) * rotate_mix + 1
          bone.a *= s
          bone.c *= s
        }
      }
      bone_x = x
      bone_y = y
      if (rotate) {
        let a = bone.a
        let b = bone.b
        let c = bone.c
        let d = bone.d
        let r: number
        if (tangents) {
          r = positions[(i + 1) * 3 - 1]
        } else if (spaces[i + 1] === 0) {
          r = positions[(i + 1) * 3 + 2]
        } else {
          r = _atan2(dy, dx)
        }
        r -= _atan2(c, a)
        if (tip) {
          let cos = Math.cos(r)
          let sin = Math.sin(r)
          let length = bone.data.length
          bone_x += (length * (cos * a - sin * c) - dx) * rotate_mix
          bone_y += (length * (sin * a + cos * c) - dy) * rotate_mix
        } else {
          r += offset_rotation
        }
        if (r > PI) {
          r -= PI2
        } else if (r < -PI) {
          r += PI2
        }
        r *= rotate_mix
        let cos = Math.cos(r)
        let sin = Math.sin(r)
        bone.a = cos * a - sin * c
        bone.b = cos * b - sin * d
        bone.c = sin * a + cos * c
        bone.d = sin * b + cos * d
      }
      bone.applied_valid = false
    }
  }

  private _compute_world_positions(path: PathAttachment, spaces_count: number, tangents: boolean,
    percent_position: boolean, percent_spacing: boolean): number[] {
    let target = this.target
    let position = this.position
    let spaces = this.spaces
    while (this.positions.length < spaces_count * 3 + 2) {
      this.positions.push(0.0)
    }
    let out = this.positions
    let closed = path.closed
    let vertices_length = path.world_vertices_length
    let curve_count = Math.floor(vertices_length / 6)
    let prev_curve = PathConstraint.NONE

    let compute_verts = (start: number, count: number): number[] => {
      return compute_mesh_vertices(target, path, Math.floor(start / 2), Math.floor(count / 2))
    }

    if (!path.constant_speed) {
      let lengths = path.lengths
      curve_count -= closed ? 1 : 2
      let path_length = lengths![curve_count]
      if (percent_position) {
        position *= path_length
      }
      if (percent_spacing) {
        for (let i = 1; i < spaces_count; i++) {
          spaces[i] *= path_length
        }
      }
      if (this.world.length < 8) {
        this.world = new Array<number>(8).fill(0.0)
      }
      let world = this.world
      let o = 0
      let curve = 0
      for (let i = 0; i < spaces_count; i++) {
        let space = spaces[i]
        position += space
        let p = position
        if (closed) {
          p %= path_length
          if (p < 0) {
            p += path_length
          }
          curve = 0
        } else if (p < 0) {
          if (prev_curve !== PathConstraint.BEFORE) {
            prev_curve = PathConstraint.BEFORE
            let w = compute_verts(2, 4)
            for (let k = 0; k < 4; k++) {
              world[k] = w[k]
            }
          }
          PathConstraint._add_before_position(p, world, 0, out, o)
          o += 3
          continue
        } else if (p > path_length) {
          if (prev_curve !== PathConstraint.AFTER) {
            prev_curve = PathConstraint.AFTER
            let w = compute_verts(vertices_length - 6, 4)
            for (let k = 0; k < 4; k++) {
              world[k] = w[k]
            }
          }
          PathConstraint._add_after_position(p - path_length, world, 0, out, o)
          o += 3
          continue
        }
        while (true) {
          let length = lengths![curve]
          if (p > length) {
            curve += 1
            continue
          }
          if (curve === 0) {
            p /= length
          } else {
            let prev = lengths![curve - 1]
            p = (p - prev) / (length - prev)
          }
          break
        }
        if (curve !== prev_curve) {
          prev_curve = curve
          if (closed && curve === curve_count) {
            let w1 = compute_verts(vertices_length - 4, 4)
            let w2 = compute_verts(0, 4)
            for (let k = 0; k < 4; k++) {
              world[k] = w1[k]
            }
            for (let k = 0; k < 4; k++) {
              world[4 + k] = w2[k]
            }
          } else {
            let w = compute_verts(curve * 6 + 2, 8)
            for (let k = 0; k < 8; k++) {
              world[k] = w[k]
            }
          }
        }
        PathConstraint._add_curve_position(p, world[0], world[1], world[2], world[3], world[4], world[5],
          world[6], world[7], out, o, tangents || (i > 0 && space === 0))
        o += 3
      }
      return out
    }
    // constantSpeed 分支（本模型不使用，省略）
    return out
  }

  private static _add_before_position(p: number, temp: number[], i: number, out: number[],
    o: number): void {
    let x1 = temp[i]
    let y1 = temp[i + 1]
    let dx = temp[i + 2] - x1
    let dy = temp[i + 3] - y1
    let r = _atan2(dy, dx)
    out[o] = x1 + p * Math.cos(r)
    out[o + 1] = y1 + p * Math.sin(r)
    out[o + 2] = r
  }

  private static _add_after_position(p: number, temp: number[], i: number, out: number[],
    o: number): void {
    let x1 = temp[i + 2]
    let y1 = temp[i + 3]
    let dx = x1 - temp[i]
    let dy = y1 - temp[i + 1]
    let r = _atan2(dy, dx)
    out[o] = x1 + p * Math.cos(r)
    out[o + 1] = y1 + p * Math.sin(r)
    out[o + 2] = r
  }

  private static _add_curve_position(p: number, x1: number, y1: number, cx1: number, cy1: number,
    cx2: number, cy2: number, x2: number, y2: number, out: number[], o: number,
    tangents: boolean): void {
    if (p === 0 || Number.isNaN(p)) {
      out[o] = x1
      out[o + 1] = y1
      out[o + 2] = _atan2(cy1 - y1, cx1 - x1)
      return
    }
    let tt = p * p
    let ttt = tt * p
    let u = 1 - p
    let uu = u * u
    let uuu = uu * u
    let ut = u * p
    let ut3 = ut * 3
    let uut3 = u * ut3
    let utt3 = ut3 * p
    let x = x1 * uuu + cx1 * uut3 + cx2 * utt3 + x2 * ttt
    let y = y1 * uuu + cy1 * uut3 + cy2 * utt3 + y2 * ttt
    out[o] = x
    out[o + 1] = y
    if (tangents) {
      if (p < 0.001) {
        out[o + 2] = _atan2(cy1 - y1, cx1 - x1)
      } else {
        out[o + 2] = _atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt),
          x - (x1 * uu + cx1 * ut * 2 + cx2 * tt))
      }
    }
  }
}

// 兼容入口：使用骨架上的持久约束实例
export function apply_constraints(skeleton: Skeleton): void {
  for (let i = 0; i < skeleton.ik_constraints.length; i++) {
    skeleton.ik_constraints[i].apply()
  }
  for (let i = 0; i < skeleton.transform_constraints.length; i++) {
    skeleton.transform_constraints[i].apply()
  }
  for (let i = 0; i < skeleton.path_constraints.length; i++) {
    skeleton.path_constraints[i].apply()
  }
}
