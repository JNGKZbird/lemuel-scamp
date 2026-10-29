// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 图集解析 — ported from spine38/atlas.py（spine-ts 3.8 TextureAtlas）。
 * AtlasRegion 与附件类定义在 loader.ets（与 Python 布局一致）；本模块单向依赖 loader。
 */
import {
  AtlasRegion, AttachmentLoader, RegionAttachment, MeshAttachment, BoundingBoxAttachment,
  PathAttachment, PointAttachment, ClippingAttachment, Skin
} from './loader'

export class AtlasPage {
  name: string
  width: number = 0
  height: number = 0
  texture: Object | null = null // 渲染器填充

  constructor(name: string) {
    this.name = name
  }
}

export class TextureAtlas {
  pages: AtlasPage[] = []
  regions: AtlasRegion[] = []

  constructor(atlasText: string, textureLoader?: (pagePath: string) => Object) {
    let lines: string[] = atlasText.split('\n')
    let page: AtlasPage | null = null
    let region: AtlasRegion | null = null
    for (let i = 0; i < lines.length; i++) {
      let line: string = lines[i].trim()
      if (line.length === 0) {
        continue
      }
      // 键值对：冒号前的部分是已知属性键
      let colon: number = line.indexOf(':')
      if (colon !== -1) {
        let key: string = line.substring(0, colon).trim()
        let value: string = line.substring(colon + 1).trim()
        if (key === 'size' && page !== null && region === null) {
          let parts: string[] = value.split(',')
          page.width = parseInt(parts[0], 10)
          page.height = parseInt(parts[1], 10)
        } else if (key === 'rotate' && region !== null) {
          region.rotate = value === 'true'
        } else if (key === 'xy' && region !== null) {
          let parts: string[] = value.split(',')
          region.x = parseInt(parts[0], 10)
          region.y = parseInt(parts[1], 10)
        } else if (key === 'size' && region !== null) {
          let parts: string[] = value.split(',')
          region.width = parseInt(parts[0], 10)
          region.height = parseInt(parts[1], 10)
        } else if (key === 'orig' && region !== null) {
          let parts: string[] = value.split(',')
          region.original_width = parseInt(parts[0], 10)
          region.original_height = parseInt(parts[1], 10)
        } else if (key === 'offset' && region !== null) {
          let parts: string[] = value.split(',')
          region.offset_x = parseInt(parts[0], 10)
          region.offset_y = parseInt(parts[1], 10)
        }
        // 其余键（format/filter/repeat/index/split/pad/pma）忽略
        continue
      }
      // 非键值行：页面名或区域名
      if (page === null) {
        page = new AtlasPage(line)
        this.pages.push(page)
        if (textureLoader !== undefined) {
          page.texture = textureLoader(line)
        }
      } else {
        region = new AtlasRegion()
        region.name = line
        region.page = page
        this.regions.push(region)
      }
    }

    // 计算 UV（照 spine-ts 3.8 TextureAtlas：旋转区域 u2 用 height、v2 用 width；
    // width/height 保持 atlas 原文语义不交换）
    for (let i = 0; i < this.regions.length; i++) {
      let region: AtlasRegion = this.regions[i]
      let page: AtlasPage = region.page as AtlasPage
      let pw: number = page.width !== 0 ? page.width : 1
      let ph: number = page.height !== 0 ? page.height : 1
      region.page_width = page.width
      region.page_height = page.height
      if (region.original_width === 0) {
        region.original_width = region.width
      }
      if (region.original_height === 0) {
        region.original_height = region.height
      }
      region.u = region.x / pw
      region.v = region.y / ph
      if (region.rotate) {
        region.u2 = (region.x + region.height) / pw
        region.v2 = (region.y + region.width) / ph
        region.degrees = 90
      } else {
        region.u2 = (region.x + region.width) / pw
        region.v2 = (region.y + region.height) / ph
      }
    }
  }

  find_region(name: string): AtlasRegion | null {
    for (let i = 0; i < this.regions.length; i++) {
      if (this.regions[i].name === name) {
        return this.regions[i]
      }
    }
    return null
  }
}

// 按图集解析附件，填充 region 引用（Python atlas.py 同款）
export class AtlasAttachmentLoaderImpl extends AttachmentLoader {
  atlas: TextureAtlas

  constructor(atlas: TextureAtlas) {
    super()
    this.atlas = atlas
  }

  new_region_attachment(_skin: Skin, name: string, path: string): RegionAttachment | null {
    let region = this.atlas.find_region(path)
    if (region === null) {
      throw new Error('Region not found in atlas: ' + path + ' (region attachment: ' + name + ')')
    }
    let a = new RegionAttachment(name)
    a.region = region
    return a
  }

  new_mesh_attachment(_skin: Skin, name: string, path: string): MeshAttachment | null {
    let region = this.atlas.find_region(path)
    if (region === null) {
      throw new Error('Region not found in atlas: ' + path + ' (mesh attachment: ' + name + ')')
    }
    let a = new MeshAttachment(name)
    a.region = region
    return a
  }

  new_bounding_box_attachment(_skin: Skin, name: string): BoundingBoxAttachment | null {
    return new BoundingBoxAttachment(name)
  }

  new_path_attachment(_skin: Skin, name: string): PathAttachment | null {
    return new PathAttachment(name)
  }

  new_point_attachment(_skin: Skin, name: string): PointAttachment | null {
    return new PointAttachment(name)
  }

  new_clipping_attachment(_skin: Skin, name: string): ClippingAttachment | null {
    return new ClippingAttachment(name)
  }
}
