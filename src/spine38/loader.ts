// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 binary skeleton loader — ported from spine38/loader.py（spine-ts 3.8 SkeletonBinary）。
 * 移植期保持 snake_case 与 Python 同名，便于 diff 比对。
 * 与 Python 的表示差异：元组/字典帧 → 类型化 Frame/Timeline 类（字段语义一致）；
 * 曲线 0/1/(cx1,cy1,cx2,cy2) → Curve 类；时间线 type 用数值常量（Python 用字符串）。
 */
import { Color, deg_to_rad } from './utils'

// ── 枚举 ──────────────────────────────────────────────
export const ATTACHMENT_REGION: number = 0
export const ATTACHMENT_BOUNDING_BOX: number = 1
export const ATTACHMENT_MESH: number = 2
export const ATTACHMENT_LINKED_MESH: number = 3
export const ATTACHMENT_PATH: number = 4
export const ATTACHMENT_POINT: number = 5
export const ATTACHMENT_CLIPPING: number = 6

export const BLEND_NORMAL: number = 0
export const BLEND_ADDITIVE: number = 1
export const BLEND_MULTIPLY: number = 2
export const BLEND_SCREEN: number = 3

export const TRANSFORM_NORMAL: number = 0
export const TRANSFORM_ONLY_TRANSLATION: number = 1
export const TRANSFORM_NO_ROTATION_OR_REFLECTION: number = 2
export const TRANSFORM_NO_SCALE: number = 3
export const TRANSFORM_NO_SCALE_OR_REFLECTION: number = 4

export const POSITION_FIXED: number = 0
export const POSITION_PERCENT: number = 1

export const SPACING_LENGTH: number = 0
export const SPACING_FIXED: number = 1
export const SPACING_PERCENT: number = 2

export const ROTATE_TANGENT: number = 0
export const ROTATE_CHAIN: number = 1
export const ROTATE_CHAIN_SCALE: number = 2

// 槽位时间线类型（分节独立枚举）
export const SLOT_ATTACHMENT: number = 0
export const SLOT_COLOR: number = 1
export const SLOT_TWO_COLOR: number = 2
// 骨骼节：0=rotate 1=translate 2=scale 3=shear（直接用数值）
// 路径节：0=position 1=spacing 2=mix（直接用数值）

// ── 附件基类 ──────────────────────────────────────────
export class Attachment {
  name: string

  constructor(name: string) {
    this.name = name
  }
}

export class VertexAttachment extends Attachment {
  bones: number[] | null = null
  vertices: number[] | null = null
  world_vertices_length: number = 0
}

export class RegionAttachment extends Attachment {
  path: string | null = null
  x: number = 0.0
  y: number = 0.0
  scale_x: number = 1.0
  scale_y: number = 1.0
  rotation: number = 0.0
  width: number = 0.0
  height: number = 0.0
  color: Color = new Color()
  region: AtlasRegion | null = null
  offset: number[] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

  // 角点顺序：BL, TL, TR, BR（JS OX1..OX4）
  update_offset(): void {
    let r = this.region!
    let ow = r.original_width !== 0 ? r.original_width : r.width
    let oh = r.original_height !== 0 ? r.original_height : r.height
    let region_scale_x = this.width / ow * this.scale_x
    let region_scale_y = this.height / oh * this.scale_y
    let local_x = -this.width / 2.0 * this.scale_x + r.offset_x * region_scale_x
    let local_y = -this.height / 2.0 * this.scale_y + r.offset_y * region_scale_y
    let local_x2 = local_x + r.width * region_scale_x
    let local_y2 = local_y + r.height * region_scale_y
    let radians = deg_to_rad(this.rotation)
    let cos = Math.cos(radians)
    let sin = Math.sin(radians)
    let local_x_cos = local_x * cos + this.x
    let local_x_sin = local_x * sin
    let local_y_cos = local_y * cos + this.y
    let local_y_sin = local_y * sin
    let local_x2_cos = local_x2 * cos + this.x
    let local_x2_sin = local_x2 * sin
    let local_y2_cos = local_y2 * cos + this.y
    let local_y2_sin = local_y2 * sin
    this.offset[0] = local_x_cos - local_y_sin
    this.offset[1] = local_y_cos + local_x_sin
    this.offset[2] = local_x_cos - local_y2_sin
    this.offset[3] = local_y2_cos + local_x_sin
    this.offset[4] = local_x2_cos - local_y2_sin
    this.offset[5] = local_y2_cos + local_x2_sin
    this.offset[6] = local_x2_cos - local_y_sin
    this.offset[7] = local_y_cos + local_x2_sin
  }
}

export class MeshAttachment extends VertexAttachment {
  path: string | null = null
  color: Color = new Color()
  triangles: number[] | null = null
  region_uvs: number[] | null = null
  uvs: number[] | null = null
  hull_length: number = 0
  edges: number[] | null = null
  width: number = 0.0
  height: number = 0.0
  region: AtlasRegion | null = null
  parent_mesh: Attachment | null = null
  deform_attachment: Attachment | null = null
  base_vertices: number[] | null = null // setup 恢复用

  // 二进制里 region_uvs 是相对区域原始空间的归一化坐标（0~1）
  update_uvs(): void {
    let ruvs = this.region_uvs
    if (ruvs === null) {
      return
    }
    if (this.uvs === null || this.uvs.length !== ruvs.length) {
      this.uvs = new Array<number>(ruvs.length).fill(0.0)
    }
    let region = this.region
    if (region === null) {
      return
    }
    let tw = region.page_width !== 0 ? region.page_width : 1.0
    let th = region.page_height !== 0 ? region.page_height : 1.0
    let u = region.u
    let v = region.v
    let uvs = this.uvs
    let ow = region.original_width !== 0 ? region.original_width : region.width
    let oh = region.original_height !== 0 ? region.original_height : region.height
    if (region.degrees === 90) {
      u -= (oh - region.offset_y - region.height) / tw
      v -= (ow - region.offset_x - region.width) / th
      let width = oh / tw
      let height = ow / th
      for (let i = 0; i < ruvs.length; i += 2) {
        uvs[i] = u + ruvs[i + 1] * width
        uvs[i + 1] = v + (1.0 - ruvs[i]) * height
      }
    } else if (region.degrees === 180) {
      u -= (ow - region.offset_x - region.width) / tw
      v -= region.offset_y / th
      let width = ow / tw
      let height = oh / th
      for (let i = 0; i < ruvs.length; i += 2) {
        uvs[i] = u + (1.0 - ruvs[i]) * width
        uvs[i + 1] = v + (1.0 - ruvs[i + 1]) * height
      }
    } else if (region.degrees === 270) {
      u -= region.offset_y / tw
      v -= region.offset_x / th
      let width = oh / tw
      let height = ow / th
      for (let i = 0; i < ruvs.length; i += 2) {
        uvs[i] = u + (1.0 - ruvs[i + 1]) * width
        uvs[i + 1] = v + ruvs[i] * height
      }
    } else {
      u -= region.offset_x / tw
      v -= (oh - region.offset_y - region.height) / th
      let width = ow / tw
      let height = oh / th
      for (let i = 0; i < ruvs.length; i += 2) {
        uvs[i] = u + ruvs[i] * width
        uvs[i + 1] = v + ruvs[i + 1] * height
      }
    }
  }
}

export class BoundingBoxAttachment extends VertexAttachment {
  color: Color = new Color()
}

export class PathAttachment extends VertexAttachment {
  closed: boolean = false
  constant_speed: boolean = false
  lengths: number[] | null = null
  color: Color = new Color()
}

export class PointAttachment extends Attachment {
  x: number = 0.0
  y: number = 0.0
  rotation: number = 0.0
  color: Color = new Color()
}

export class ClippingAttachment extends VertexAttachment {
  end_slot: SlotData | null = null
  color: Color = new Color()
}

// ── 图集区域（由 atlas.ets 解析填充；Python 同款布局定义于此） ──
export class AtlasRegion {
  page: Object | null = null
  name: string = ''
  u: number = 0.0
  v: number = 0.0
  u2: number = 0.0
  v2: number = 0.0
  x: number = 0
  y: number = 0
  width: number = 0
  height: number = 0
  original_width: number = 0
  original_height: number = 0
  offset_x: number = 0
  offset_y: number = 0
  page_width: number = 0
  page_height: number = 0
  degrees: number = 0
  rotate: boolean = false
}

// ── 数据类 ─────────────────────────────────────────────
export class BoneData {
  index: number
  name: string
  parent: BoneData | null
  length: number = 0.0
  x: number = 0.0
  y: number = 0.0
  rotation: number = 0.0
  scale_x: number = 1.0
  scale_y: number = 1.0
  shear_x: number = 0.0
  shear_y: number = 0.0
  transform_mode: number = TRANSFORM_NORMAL
  skin_required: boolean = false
  color: Color = new Color()

  constructor(index: number, name: string, parent: BoneData | null) {
    this.index = index
    this.name = name
    this.parent = parent
  }
}

export class SlotData {
  index: number
  name: string
  bone_data: BoneData
  color: Color = new Color()
  dark_color: Color | null = null
  attachment_name: string | null = null
  blend_mode: number = BLEND_NORMAL

  constructor(index: number, name: string, bone_data: BoneData) {
    this.index = index
    this.name = name
    this.bone_data = bone_data
  }
}

export class IkConstraintData {
  name: string
  order: number = 0
  skin_required: boolean = false
  bones: BoneData[] = []
  target: BoneData | null = null
  mix: number = 1.0
  softness: number = 0.0
  bend_direction: number = 1
  compress: boolean = false
  stretch: boolean = false
  uniform: boolean = false

  constructor(name: string) {
    this.name = name
  }
}

export class TransformConstraintData {
  name: string
  order: number = 0
  skin_required: boolean = false
  bones: BoneData[] = []
  target: BoneData | null = null
  local: boolean = false
  relative: boolean = false
  offset_rotation: number = 0.0
  offset_x: number = 0.0
  offset_y: number = 0.0
  offset_scale_x: number = 1.0
  offset_scale_y: number = 1.0
  offset_shear_y: number = 0.0
  rotate_mix: number = 1.0
  translate_mix: number = 1.0
  scale_mix: number = 1.0
  shear_mix: number = 1.0

  constructor(name: string) {
    this.name = name
  }
}

export class PathConstraintData {
  name: string
  order: number = 0
  skin_required: boolean = false
  bones: BoneData[] = []
  target: SlotData | null = null
  position_mode: number = POSITION_FIXED
  spacing_mode: number = SPACING_LENGTH
  rotate_mode: number = ROTATE_TANGENT
  offset_rotation: number = 0.0
  position: number = 0.0
  spacing: number = 0.0
  rotate_mix: number = 1.0
  translate_mix: number = 1.0

  constructor(name: string) {
    this.name = name
  }
}

export class EventData {
  name: string
  int_value: number = 0
  float_value: number = 0.0
  string_value: string | null = null
  audio_path: string | null = null
  volume: number = 0.0
  balance: number = 0.0

  constructor(name: string) {
    this.name = name
  }
}

// ── 附件加载器接口 ─────────────────────────────────────
export abstract class AttachmentLoader {
  abstract new_region_attachment(skin: Skin, name: string, path: string): RegionAttachment | null

  abstract new_mesh_attachment(skin: Skin, name: string, path: string): MeshAttachment | null

  abstract new_bounding_box_attachment(skin: Skin, name: string): BoundingBoxAttachment | null

  abstract new_path_attachment(skin: Skin, name: string): PathAttachment | null

  abstract new_point_attachment(skin: Skin, name: string): PointAttachment | null

  abstract new_clipping_attachment(skin: Skin, name: string): ClippingAttachment | null
}

// ── 皮肤 ──────────────────────────────────────────────
export class Skin {
  name: string
  attachments: Map<number, Map<string, Attachment>> = new Map() // slot_index -> name -> attachment

  constructor(name: string) {
    this.name = name
  }

  set_attachment(slot_index: number, name: string, attachment: Attachment): void {
    let inner = this.attachments.get(slot_index)
    if (inner === undefined) {
      inner = new Map<string, Attachment>()
      this.attachments.set(slot_index, inner)
    }
    inner.set(name, attachment)
  }

  get_attachment(slot_index: number, name: string): Attachment | null {
    let inner = this.attachments.get(slot_index)
    if (inner === undefined) {
      return null
    }
    let a = inner.get(name)
    return a === undefined ? null : a
  }
}

// ── 骨骼数据 ──────────────────────────────────────────
export class SkeletonData {
  name: string = ''
  bones: BoneData[] = []
  slots: SlotData[] = []
  skins: Skin[] = []
  default_skin: Skin | null = null
  events: EventData[] = []
  animations: Animation[] = []
  ik_constraints: IkConstraintData[] = []
  transform_constraints: TransformConstraintData[] = []
  path_constraints: PathConstraintData[] = []
  x: number = 0.0
  y: number = 0.0
  width: number = 0.0
  height: number = 0.0
  version: string | null = null
  hash: string | null = null
  fps: number = 0.0

  find_bone(name: string): BoneData | null {
    for (let i = 0; i < this.bones.length; i++) {
      if (this.bones[i].name === name) {
        return this.bones[i]
      }
    }
    return null
  }

  find_skin(name: string): Skin | null {
    for (let i = 0; i < this.skins.length; i++) {
      if (this.skins[i].name === name) {
        return this.skins[i]
      }
    }
    return null
  }

  find_event(name: string): EventData | null {
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i].name === name) {
        return this.events[i]
      }
    }
    return null
  }

  find_animation(name: string): Animation | null {
    for (let i = 0; i < this.animations.length; i++) {
      if (this.animations[i].name === name) {
        return this.animations[i]
      }
    }
    return null
  }
}

// ── 二进制读取器（spine 二进制全大端） ──────────────────
export class BinaryInput {
  data: Uint8Array
  view: DataView
  pos: number = 0
  strings: (string | null)[] = []

  constructor(data: Uint8Array) {
    this.data = data
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  read_byte(): number {
    return this.data[this.pos++]
  }

  read_sbyte(): number {
    let v = this.data[this.pos++]
    return v > 127 ? v - 256 : v
  }

  read_boolean(): boolean {
    return this.read_byte() !== 0
  }

  read_short(): number {
    let v = this.view.getInt16(this.pos, false)
    this.pos += 2
    return v
  }

  // varint：高位续读；JS 位运算按 32 位，需无符号化后再转有符号（如绘制顺序 -44 偏移）
  read_int(optimize_positive: boolean = false): number {
    let b = this.read_byte()
    let result = b & 0x7F
    if ((b & 0x80) !== 0) {
      b = this.read_byte()
      result |= (b & 0x7F) << 7
      if ((b & 0x80) !== 0) {
        b = this.read_byte()
        result |= (b & 0x7F) << 14
        if ((b & 0x80) !== 0) {
          b = this.read_byte()
          result |= (b & 0x7F) << 21
          if ((b & 0x80) !== 0) {
            b = this.read_byte()
            result |= (b & 0x7F) << 28
          }
        }
      }
    }
    result = result >>> 0
    if (result >= 0x80000000) {
      result -= 0x100000000
    }
    return optimize_positive ? result : (result >> 1) ^ -(result & 1)
  }

  read_int32(): number {
    let v = this.view.getInt32(this.pos, false)
    this.pos += 4
    return v
  }

  read_float(): number {
    let v = this.view.getFloat32(this.pos, false)
    this.pos += 4
    return v
  }

  read_string(): string | null {
    let n = this.read_int(true)
    if (n === 0) {
      return null
    }
    if (n === 1) {
      return ''
    }
    n -= 1
    // latin-1：每字节一个字符
    let chars: string[] = []
    for (let i = 0; i < n; i++) {
      chars.push(String.fromCharCode(this.data[this.pos + i]))
    }
    this.pos += n
    return chars.join('')
  }

  read_string_ref(): string | null {
    let idx = this.read_int(true)
    if (idx === 0) {
      return null
    }
    idx -= 1
    if (idx < this.strings.length) {
      return this.strings[idx]
    }
    return null
  }
}

// ── 时间线数据（Python 的元组/字典帧 → 类型化类） ──────
export class Curve {
  type: number = 0 // 0=linear 1=stepped 2=bezier
  cx1: number = 0
  cy1: number = 0
  cx2: number = 0
  cy2: number = 0
}

export class SlotAttachmentFrame {
  time: number
  name: string | null

  constructor(time: number, name: string | null) {
    this.time = time
    this.name = name
  }
}

export class SlotColorFrame {
  time: number
  color: Color
  dark: Color | null

  constructor(time: number, color: Color, dark: Color | null) {
    this.time = time
    this.color = color
    this.dark = dark
  }
}

export class SlotTimeline {
  type: number = 0 // SLOT_ATTACHMENT / SLOT_COLOR / SLOT_TWO_COLOR
  slot: number = 0
  attachment_frames: SlotAttachmentFrame[] = []
  color_frames: SlotColorFrame[] = []
}

export class BoneFrame {
  time: number
  f1: number
  f2: number // rotate 只用 f1；translate/scale/shear 用 f1,f2

  constructor(time: number, f1: number, f2: number) {
    this.time = time
    this.f1 = f1
    this.f2 = f2
  }
}

export class BoneTimeline {
  type: number = 0 // 0=rotate 1=translate 2=scale 3=shear
  bone: number = 0
  frames: BoneFrame[] = []
  curves: Curve[] = []
}

export class IkFrame {
  time: number
  mix: number
  softness: number
  bend: number // 有符号字节（勿按无符号读）
  compress: boolean
  stretch: boolean

  constructor(time: number, mix: number, softness: number, bend: number, compress: boolean, stretch: boolean) {
    this.time = time
    this.mix = mix
    this.softness = softness
    this.bend = bend
    this.compress = compress
    this.stretch = stretch
  }
}

export class IkTimeline {
  index: number = 0
  frames: IkFrame[] = []
  curves: Curve[] = []
}

export class TransformFrame {
  time: number
  f1: number
  f2: number
  f3: number
  f4: number

  constructor(time: number, f1: number, f2: number, f3: number, f4: number) {
    this.time = time
    this.f1 = f1
    this.f2 = f2
    this.f3 = f3
    this.f4 = f4
  }
}

export class TransformTimeline {
  index: number = 0
  frames: TransformFrame[] = []
  curves: Curve[] = []
}

export class PathFrame {
  time: number
  value: number

  constructor(time: number, value: number) {
    this.time = time
    this.value = value
  }
}

export class PathMixFrame {
  time: number
  m1: number
  m2: number

  constructor(time: number, m1: number, m2: number) {
    this.time = time
    this.m1 = m1
    this.m2 = m2
  }
}

export class PathTimeline {
  type: number = 0 // 0=position 1=spacing 2=mix
  index: number = 0
  frames: PathFrame[] = []
  mix_frames: PathMixFrame[] = []
}

export class DeformFrame {
  time: number
  values: number[]

  constructor(time: number, values: number[]) {
    this.time = time
    this.values = values
  }
}

export class DeformTimeline {
  skin: Skin | null = null
  slot: number = 0
  attachment: VertexAttachment | null = null
  frames: DeformFrame[] = []
}

export class DrawOrderOffset {
  slot: number
  offset: number

  constructor(slot: number, offset: number) {
    this.slot = slot
    this.offset = offset
  }
}

export class DrawOrderFrame {
  time: number
  offsets: DrawOrderOffset[]

  constructor(time: number, offsets: DrawOrderOffset[]) {
    this.time = time
    this.offsets = offsets
  }
}

export class DrawOrderTimeline {
  frames: DrawOrderFrame[] = []
}

export class EventFrame {
  time: number
  event: EventData

  constructor(time: number, event: EventData) {
    this.time = time
    this.event = event
  }
}

export class EventTimeline {
  frames: EventFrame[] = []
}

// ── 动画 ──────────────────────────────────────────────
export class Animation {
  name: string
  duration: number = 0.0
  slot_timelines: SlotTimeline[] = []
  bone_timelines: BoneTimeline[] = []
  ik_timelines: IkTimeline[] = []
  transform_timelines: TransformTimeline[] = []
  path_timelines: PathTimeline[] = []
  deform_timelines: DeformTimeline[] = []
  event_timelines: EventTimeline[] = []
  draw_order_timelines: DrawOrderTimeline[] = []

  constructor(name: string) {
    this.name = name
  }
}

// ── 内部辅助类 ────────────────────────────────────────
class VerticesResult {
  vertices: number[] = []
  bones: number[] | null = null
}

class LinkedMesh {
  mesh: MeshAttachment
  skin_name: string | null
  slot_index: number
  parent: string
  inherit_deform: boolean

  constructor(mesh: MeshAttachment, skin_name: string | null, slot_index: number, parent: string,
    inherit_deform: boolean) {
    this.mesh = mesh
    this.skin_name = skin_name
    this.slot_index = slot_index
    this.parent = parent
    this.inherit_deform = inherit_deform
  }
}

// ── 骨骼加载器 ────────────────────────────────────────
export class SkeletonBinary {
  scale: number = 1.0
  attachment_loader: AttachmentLoader
  private linked_meshes: LinkedMesh[] = []

  constructor(attachment_loader: AttachmentLoader) {
    this.attachment_loader = attachment_loader
  }

  read_skeleton_data(data: Uint8Array): SkeletonData {
    let scale = this.scale
    let sd = new SkeletonData()
    let inp = new BinaryInput(data)
    sd.hash = inp.read_string()
    sd.version = inp.read_string()
    if (sd.version === '3.8.75') {
      throw new Error('Unsupported skeleton data, please export with a newer version of Spine.')
    }
    sd.x = inp.read_float()
    sd.y = inp.read_float()
    sd.width = inp.read_float()
    sd.height = inp.read_float()
    let nonessential = inp.read_boolean()
    if (nonessential) {
      sd.fps = inp.read_float()
      inp.read_string() // images path
      inp.read_string() // audio path
    }

    let n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      inp.strings.push(inp.read_string())
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let name = inp.read_string()!
      let parent = i === 0 ? null : sd.bones[inp.read_int(true)]
      let bd = new BoneData(i, name, parent)
      bd.rotation = inp.read_float()
      bd.x = inp.read_float() * scale
      bd.y = inp.read_float() * scale
      bd.scale_x = inp.read_float()
      bd.scale_y = inp.read_float()
      bd.shear_x = inp.read_float()
      bd.shear_y = inp.read_float()
      bd.length = inp.read_float() * scale
      bd.transform_mode = inp.read_int(true)
      bd.skin_required = inp.read_boolean()
      if (nonessential) {
        Color.rgba8888(bd.color, inp.read_int32())
      }
      sd.bones.push(bd)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let slot_name = inp.read_string()!
      let bone_data = sd.bones[inp.read_int(true)]
      let sld = new SlotData(i, slot_name, bone_data)
      Color.rgba8888(sld.color, inp.read_int32())
      let dark = inp.read_int32()
      if (dark !== -1) {
        sld.dark_color = new Color()
        Color.rgb888(sld.dark_color, dark)
      }
      sld.attachment_name = inp.read_string_ref()
      sld.blend_mode = inp.read_int(true)
      sd.slots.push(sld)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let d = new IkConstraintData(inp.read_string()!)
      d.order = inp.read_int(true)
      d.skin_required = inp.read_boolean()
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        d.bones.push(sd.bones[inp.read_int(true)])
      }
      d.target = sd.bones[inp.read_int(true)]
      d.mix = inp.read_float()
      d.softness = inp.read_float() * scale
      d.bend_direction = inp.read_sbyte() // 有符号字节（255≠-1）
      d.compress = inp.read_boolean()
      d.stretch = inp.read_boolean()
      d.uniform = inp.read_boolean()
      sd.ik_constraints.push(d)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let d = new TransformConstraintData(inp.read_string()!)
      d.order = inp.read_int(true)
      d.skin_required = inp.read_boolean()
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        d.bones.push(sd.bones[inp.read_int(true)])
      }
      d.target = sd.bones[inp.read_int(true)]
      d.local = inp.read_boolean()
      d.relative = inp.read_boolean()
      d.offset_rotation = inp.read_float()
      d.offset_x = inp.read_float() * scale
      d.offset_y = inp.read_float() * scale
      d.offset_scale_x = inp.read_float()
      d.offset_scale_y = inp.read_float()
      d.offset_shear_y = inp.read_float()
      d.rotate_mix = inp.read_float()
      d.translate_mix = inp.read_float()
      d.scale_mix = inp.read_float()
      d.shear_mix = inp.read_float()
      sd.transform_constraints.push(d)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let d = new PathConstraintData(inp.read_string()!)
      d.order = inp.read_int(true)
      d.skin_required = inp.read_boolean()
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        d.bones.push(sd.bones[inp.read_int(true)])
      }
      d.target = sd.slots[inp.read_int(true)]
      d.position_mode = inp.read_int(true)
      d.spacing_mode = inp.read_int(true)
      d.rotate_mode = inp.read_int(true)
      d.offset_rotation = inp.read_float()
      d.position = inp.read_float()
      if (d.position_mode === POSITION_FIXED) {
        d.position *= scale
      }
      d.spacing = inp.read_float()
      if (d.spacing_mode === SPACING_LENGTH || d.spacing_mode === SPACING_FIXED) {
        d.spacing *= scale
      }
      d.rotate_mix = inp.read_float()
      d.translate_mix = inp.read_float()
      sd.path_constraints.push(d)
    }

    let default_skin = this._read_skin(inp, sd, true, nonessential)
    if (default_skin !== null) {
      sd.default_skin = default_skin
      sd.skins.push(default_skin)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let s = this._read_skin(inp, sd, false, nonessential)
      if (s !== null) {
        sd.skins.push(s)
      }
    }

    // linked meshes
    for (let i = 0; i < this.linked_meshes.length; i++) {
      let lm = this.linked_meshes[i]
      let skin = lm.skin_name === null ? sd.default_skin : sd.find_skin(lm.skin_name)
      if (skin === null) {
        throw new Error('Skin not found: ' + lm.skin_name)
      }
      let parent = skin.get_attachment(lm.slot_index, lm.parent)
      if (parent === null) {
        throw new Error('Parent mesh not found: ' + lm.parent)
      }
      lm.mesh.deform_attachment = lm.inherit_deform ? parent : lm.mesh
      lm.mesh.parent_mesh = parent
      lm.mesh.update_uvs()
    }
    this.linked_meshes = []

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let d = new EventData(inp.read_string_ref()!)
      d.int_value = inp.read_int(false)
      d.float_value = inp.read_float()
      d.string_value = inp.read_string()
      d.audio_path = inp.read_string()
      if (d.audio_path !== null) {
        d.volume = inp.read_float()
        d.balance = inp.read_float()
      }
      sd.events.push(d)
    }

    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      sd.animations.push(this._read_animation(inp, inp.read_string()!, sd))
    }
    return sd
  }

  private _read_skin(inp: BinaryInput, sd: SkeletonData, is_default: boolean, nonessential: boolean): Skin | null {
    let skin: Skin | null = null
    let slot_count = 0
    if (is_default) {
      slot_count = inp.read_int(true)
      if (slot_count === 0) {
        return null
      }
      skin = new Skin('default')
    } else {
      skin = new Skin(inp.read_string_ref()!)
      let nb = inp.read_int(true)
      for (let i = 0; i < nb; i++) {
        inp.read_int(true) // bone index (skin.bones not needed)
      }
      let nc = inp.read_int(true)
      for (let i = 0; i < nc; i++) {
        inp.read_int(true) // ik constraint
      }
      nc = inp.read_int(true)
      for (let i = 0; i < nc; i++) {
        inp.read_int(true) // transform constraint
      }
      nc = inp.read_int(true)
      for (let i = 0; i < nc; i++) {
        inp.read_int(true) // path constraint
      }
      slot_count = inp.read_int(true)
    }
    let s: Skin = skin!
    for (let i = 0; i < slot_count; i++) {
      let slot_index = inp.read_int(true)
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        let name = inp.read_string_ref()
        let attachment = this._read_attachment(inp, sd, s, slot_index, name, nonessential)
        if (attachment !== null) {
          s.set_attachment(slot_index, name!, attachment)
        }
      }
    }
    return s
  }

  private _read_attachment(inp: BinaryInput, sd: SkeletonData, skin: Skin, slot_index: number,
    attachment_name: string | null, nonessential: boolean): Attachment | null {
    let scale = this.scale
    let name = inp.read_string_ref()
    if (name === null) {
      name = attachment_name
    }
    let type_index = inp.read_byte()
    let loader = this.attachment_loader
    if (type_index === ATTACHMENT_REGION) {
      let path = inp.read_string_ref()
      let rotation = inp.read_float()
      let x = inp.read_float()
      let y = inp.read_float()
      let sx = inp.read_float()
      let sy = inp.read_float()
      let width = inp.read_float()
      let height = inp.read_float()
      let color = inp.read_int32()
      if (path === null) {
        path = name
      }
      let a = loader.new_region_attachment(skin, name!, path!)
      if (a === null) {
        return null
      }
      a.path = path
      a.x = x * scale
      a.y = y * scale
      a.scale_x = sx
      a.scale_y = sy
      a.rotation = rotation
      a.width = width * scale
      a.height = height * scale
      Color.rgba8888(a.color, color)
      a.update_offset()
      return a
    }
    if (type_index === ATTACHMENT_BOUNDING_BOX) {
      let vertex_count = inp.read_int(true)
      let vr = this._read_vertices(inp, vertex_count)
      let color = nonessential ? inp.read_int32() : 0
      let a = loader.new_bounding_box_attachment(skin, name!)
      if (a === null) {
        return null
      }
      a.world_vertices_length = vertex_count << 1
      a.vertices = vr.vertices
      a.bones = vr.bones
      if (nonessential) {
        Color.rgba8888(a.color, color)
      }
      return a
    }
    if (type_index === ATTACHMENT_MESH) {
      let path = inp.read_string_ref()
      let color = inp.read_int32()
      let vertex_count = inp.read_int(true)
      let uvs = this._read_float_array(inp, vertex_count << 1, 1.0)
      let triangles = this._read_short_array(inp)
      let vr = this._read_vertices(inp, vertex_count)
      let hull_length = inp.read_int(true)
      let edges: number[] | null = null
      let width = 0.0
      let height = 0.0
      if (nonessential) {
        edges = this._read_short_array(inp)
        width = inp.read_float()
        height = inp.read_float()
      }
      if (path === null) {
        path = name
      }
      let a = loader.new_mesh_attachment(skin, name!, path!)
      if (a === null) {
        return null
      }
      a.path = path
      Color.rgba8888(a.color, color)
      a.bones = vr.bones
      a.vertices = vr.vertices
      a.base_vertices = vr.vertices.slice()
      a.world_vertices_length = vertex_count << 1
      a.triangles = triangles
      a.region_uvs = uvs
      a.update_uvs()
      a.hull_length = hull_length << 1
      if (nonessential) {
        a.edges = edges
        a.width = width * scale
        a.height = height * scale
      }
      return a
    }
    if (type_index === ATTACHMENT_LINKED_MESH) {
      let path = inp.read_string_ref()
      let color = inp.read_int32()
      let skin_name = inp.read_string_ref()
      let parent = inp.read_string_ref()
      let inherit_deform = inp.read_boolean()
      let width = 0.0
      let height = 0.0
      if (nonessential) {
        width = inp.read_float()
        height = inp.read_float()
      }
      if (path === null) {
        path = name
      }
      let a = loader.new_mesh_attachment(skin, name!, path!)
      if (a === null) {
        return null
      }
      a.path = path
      Color.rgba8888(a.color, color)
      if (nonessential) {
        a.width = width * scale
        a.height = height * scale
      }
      this.linked_meshes.push(new LinkedMesh(a, skin_name, slot_index, parent!, inherit_deform))
      return a
    }
    if (type_index === ATTACHMENT_PATH) {
      let closed = inp.read_boolean()
      let constant_speed = inp.read_boolean()
      let vertex_count = inp.read_int(true)
      let vr = this._read_vertices(inp, vertex_count)
      let lengths: number[] = []
      let lc = Math.floor(vertex_count / 3)
      for (let i = 0; i < lc; i++) {
        lengths.push(inp.read_float() * scale)
      }
      let color = nonessential ? inp.read_int32() : 0
      let a = loader.new_path_attachment(skin, name!)
      if (a === null) {
        return null
      }
      a.closed = closed
      a.constant_speed = constant_speed
      a.world_vertices_length = vertex_count << 1
      a.vertices = vr.vertices
      a.bones = vr.bones
      a.lengths = lengths
      if (nonessential) {
        Color.rgba8888(a.color, color)
      }
      return a
    }
    if (type_index === ATTACHMENT_POINT) {
      let rotation = inp.read_float()
      let x = inp.read_float()
      let y = inp.read_float()
      let color = nonessential ? inp.read_int32() : 0
      let a = loader.new_point_attachment(skin, name!)
      if (a === null) {
        return null
      }
      a.x = x * scale
      a.y = y * scale
      a.rotation = rotation
      if (nonessential) {
        Color.rgba8888(a.color, color)
      }
      return a
    }
    if (type_index === ATTACHMENT_CLIPPING) {
      let end_slot_index = inp.read_int(true)
      let vertex_count = inp.read_int(true)
      let vr = this._read_vertices(inp, vertex_count)
      let color = nonessential ? inp.read_int32() : 0
      let a = loader.new_clipping_attachment(skin, name!)
      if (a === null) {
        return null
      }
      a.end_slot = sd.slots[end_slot_index]
      a.world_vertices_length = vertex_count << 1
      a.vertices = vr.vertices
      a.bones = vr.bones
      if (nonessential) {
        Color.rgba8888(a.color, color)
      }
      return a
    }
    return null
  }

  private _read_vertices(inp: BinaryInput, vertex_count: number): VerticesResult {
    let vertices_length = vertex_count << 1
    let scale = this.scale
    if (!inp.read_boolean()) {
      let r = new VerticesResult()
      r.vertices = this._read_float_array(inp, vertices_length, scale)
      r.bones = null
      return r
    }
    let weights: number[] = []
    let bones: number[] = []
    for (let i = 0; i < vertex_count; i++) {
      let bone_count = inp.read_int(true)
      bones.push(bone_count)
      for (let j = 0; j < bone_count; j++) {
        bones.push(inp.read_int(true))
        weights.push(inp.read_float() * scale)
        weights.push(inp.read_float() * scale)
        weights.push(inp.read_float())
      }
    }
    let r = new VerticesResult()
    r.vertices = weights
    r.bones = bones
    return r
  }

  private _read_float_array(inp: BinaryInput, n: number, scale: number): number[] {
    let arr: number[] = []
    if (scale === 1.0) {
      for (let i = 0; i < n; i++) {
        arr.push(inp.read_float())
      }
    } else {
      for (let i = 0; i < n; i++) {
        arr.push(inp.read_float() * scale)
      }
    }
    return arr
  }

  private _read_short_array(inp: BinaryInput): number[] {
    let n = inp.read_int(true)
    let arr: number[] = []
    for (let i = 0; i < n; i++) {
      arr.push(inp.read_short())
    }
    return arr
  }

  private _read_animation(inp: BinaryInput, name: string, sd: SkeletonData): Animation {
    let animation = new Animation(name)
    let scale = this.scale
    let duration = 0.0

    // 槽位时间线
    let n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let slot_index = inp.read_int(true)
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        let timeline_type = inp.read_byte()
        let frame_count = inp.read_int(true)
        let tl = new SlotTimeline()
        tl.type = timeline_type
        tl.slot = slot_index
        if (timeline_type === SLOT_ATTACHMENT) {
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            tl.attachment_frames.push(new SlotAttachmentFrame(t, inp.read_string_ref()))
          }
          animation.slot_timelines.push(tl)
          duration = Math.max(duration, tl.attachment_frames[tl.attachment_frames.length - 1].time)
        } else if (timeline_type === SLOT_COLOR || timeline_type === SLOT_TWO_COLOR) {
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            let c1 = new Color()
            Color.rgba8888(c1, inp.read_int32())
            let c2: Color | null = null
            if (timeline_type === SLOT_TWO_COLOR) {
              c2 = new Color()
              Color.rgb888(c2, inp.read_int32())
            }
            tl.color_frames.push(new SlotColorFrame(t, c1, c2))
            if (k < frame_count - 1) {
              this._read_curve(inp) // Python 读了即弃（槽位颜色用线性插值）
            }
          }
          animation.slot_timelines.push(tl)
          duration = Math.max(duration, tl.color_frames[tl.color_frames.length - 1].time)
        }
      }
    }

    // 骨骼时间线（类型枚举独立：0=rotate 1=translate 2=scale 3=shear）
    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let bone_index = inp.read_int(true)
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        let timeline_type = inp.read_byte()
        let frame_count = inp.read_int(true)
        let tl = new BoneTimeline()
        tl.type = timeline_type
        tl.bone = bone_index
        if (timeline_type === 0) { // rotate
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            tl.frames.push(new BoneFrame(t, inp.read_float(), 0.0))
            if (k < frame_count - 1) {
              tl.curves.push(this._read_curve(inp))
            }
          }
          animation.bone_timelines.push(tl)
          duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
        } else if (timeline_type === 1 || timeline_type === 2 || timeline_type === 3) { // translate / scale / shear
          let tscale = timeline_type === 1 ? scale : 1.0
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            tl.frames.push(new BoneFrame(t, inp.read_float() * tscale, inp.read_float() * tscale))
            if (k < frame_count - 1) {
              tl.curves.push(this._read_curve(inp))
            }
          }
          animation.bone_timelines.push(tl)
          duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
        }
      }
    }

    // IK 约束时间线
    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let index = inp.read_int(true)
      let frame_count = inp.read_int(true)
      let tl = new IkTimeline()
      tl.index = index
      for (let k = 0; k < frame_count; k++) {
        let t = inp.read_float()
        tl.frames.push(new IkFrame(t, inp.read_float(), inp.read_float() * scale, inp.read_sbyte(),
          inp.read_boolean(), inp.read_boolean()))
        if (k < frame_count - 1) {
          tl.curves.push(this._read_curve(inp))
        }
      }
      animation.ik_timelines.push(tl)
      duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
    }

    // 变换约束时间线
    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let index = inp.read_int(true)
      let frame_count = inp.read_int(true)
      let tl = new TransformTimeline()
      tl.index = index
      for (let k = 0; k < frame_count; k++) {
        let t = inp.read_float()
        tl.frames.push(new TransformFrame(t, inp.read_float(), inp.read_float(), inp.read_float(), inp.read_float()))
        if (k < frame_count - 1) {
          tl.curves.push(this._read_curve(inp))
        }
      }
      animation.transform_timelines.push(tl)
      duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
    }

    // 路径约束时间线（类型枚举独立：0=position 1=spacing 2=mix）
    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let index = inp.read_int(true)
      let data = sd.path_constraints[index]
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        let timeline_type = inp.read_byte()
        let frame_count = inp.read_int(true)
        let tl = new PathTimeline()
        tl.type = timeline_type
        tl.index = index
        if (timeline_type === 0 || timeline_type === 1) { // position / spacing
          let tscale = 1.0
          if (timeline_type === 1 && (data.spacing_mode === SPACING_LENGTH || data.spacing_mode === SPACING_FIXED)) {
            tscale = scale
          } else if (timeline_type === 0 && data.position_mode === POSITION_FIXED) {
            tscale = scale
          }
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            tl.frames.push(new PathFrame(t, inp.read_float() * tscale))
            if (k < frame_count - 1) {
              this._read_curve(inp) // 读了即弃（Python 同）
            }
          }
          animation.path_timelines.push(tl)
          duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
        } else if (timeline_type === 2) { // mix
          for (let k = 0; k < frame_count; k++) {
            let t = inp.read_float()
            tl.mix_frames.push(new PathMixFrame(t, inp.read_float(), inp.read_float()))
            if (k < frame_count - 1) {
              this._read_curve(inp) // 读了即弃（Python 同）
            }
          }
          animation.path_timelines.push(tl)
          duration = Math.max(duration, tl.mix_frames[tl.mix_frames.length - 1].time)
        }
      }
    }

    // 变形时间线：skin → nn(插槽数) → slotIndex → nnn(附件数) → 附件
    n = inp.read_int(true)
    for (let i = 0; i < n; i++) {
      let skin = sd.skins[inp.read_int(true)]
      let nn = inp.read_int(true)
      for (let j = 0; j < nn; j++) {
        let slot_index = inp.read_int(true)
        let nnn = inp.read_int(true)
        for (let k = 0; k < nnn; k++) {
          let att_name = inp.read_string_ref()
          let attachment = skin.get_attachment(slot_index, att_name!) as VertexAttachment | null
          let weighted = attachment !== null && attachment.bones !== null
          let vertices = attachment !== null ? attachment.vertices : null
          let deform_length = 0
          if (vertices !== null) {
            if (weighted) {
              deform_length = Math.floor(vertices.length / 3) * 2
            } else {
              deform_length = vertices.length
            }
          }
          let frame_count = inp.read_int(true)
          let tl = new DeformTimeline()
          tl.skin = skin
          tl.slot = slot_index
          tl.attachment = attachment
          for (let f = 0; f < frame_count; f++) {
            let t = inp.read_float()
            let end = inp.read_int(true)
            let deform: number[]
            if (end === 0) {
              // 空变形：加权=全零，非加权=原顶点
              deform = weighted ? new Array<number>(deform_length).fill(0.0) : vertices!.slice()
            } else {
              deform = new Array<number>(deform_length).fill(0.0)
              let start = inp.read_int(true)
              end += start
              let limit = Math.min(end, deform_length)
              for (let v = start; v < limit; v++) {
                deform[v] = inp.read_float() * scale
              }
              if (!weighted) {
                for (let v = 0; v < deform_length; v++) {
                  deform[v] += vertices![v]
                }
              }
            }
            tl.frames.push(new DeformFrame(t, deform))
            if (f < frame_count - 1) {
              this._read_curve(inp) // 读了即弃（Python 同）
            }
          }
          animation.deform_timelines.push(tl)
          duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
        }
      }
    }

    // 绘制顺序时间线（在事件之前）：drawOrderCount = 帧数，单时间线
    // 每帧：time + offsetCount + 每偏移 (slotIndex, offset) 两个 varint
    let draw_order_count = inp.read_int(true)
    if (draw_order_count > 0) {
      let tl = new DrawOrderTimeline()
      for (let i = 0; i < draw_order_count; i++) {
        let t = inp.read_float()
        let offset_count = inp.read_int(true)
        let offsets: DrawOrderOffset[] = []
        for (let j = 0; j < offset_count; j++) {
          let slot_i = inp.read_int(true)
          let off = inp.read_int(true)
          offsets.push(new DrawOrderOffset(slot_i, off))
        }
        tl.frames.push(new DrawOrderFrame(t, offsets))
      }
      animation.draw_order_timelines.push(tl)
      duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
    }

    // 事件时间线：eventCount = 帧数，单时间线；时间只读一次
    let event_count = inp.read_int(true)
    if (event_count > 0) {
      let tl = new EventTimeline()
      for (let i = 0; i < event_count; i++) {
        let t = inp.read_float()
        let d = sd.events[inp.read_int(true)]
        let e = new EventData(d.name)
        e.int_value = inp.read_int(false)
        e.float_value = inp.read_float()
        if (inp.read_boolean()) {
          e.string_value = inp.read_string()
        } else {
          e.string_value = d.string_value
        }
        if (d.audio_path !== null) {
          e.volume = inp.read_float()
          e.balance = inp.read_float()
        }
        tl.frames.push(new EventFrame(t, e))
      }
      animation.event_timelines.push(tl)
      duration = Math.max(duration, tl.frames[tl.frames.length - 1].time)
    }

    animation.duration = duration
    return animation
  }

  // 曲线数据：0=线性 1=阶梯 或 (cx1,cy1,cx2,cy2) 单段贝塞尔
  private _read_curve(inp: BinaryInput): Curve {
    let curve_type = inp.read_byte()
    let c = new Curve()
    c.type = curve_type
    if (curve_type === 2) {
      c.cx1 = inp.read_float()
      c.cy1 = inp.read_float()
      c.cx2 = inp.read_float()
      c.cy2 = inp.read_float()
    }
    return c
  }
}
