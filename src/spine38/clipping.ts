// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * 官方 spine-ts 3.8 SkeletonClipping 逐行移植（Windows clipping.py → ArkTS）。
 * 裁剪附件世界顶点 → makeClockwise → ear-clipping 三角化 → 凸分解 →
 * Sutherland-Hodgman 逐三角形裁剪。自交多边形下 S-H 结果 = 所有边半平面交，
 * 与 even-odd 掩码语义完全不同——坐/睡眼白泄漏的根治（2026-08-20）。
 */

export class ClippedTri {
  pts: number[] = [] // 骨架坐标平铺（未闭合）
  uvs: number[] = [] // 对应 UV 平铺
}

function positiveArea(p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number): boolean {
  return p1x * (p3y - p2y) + p2x * (p1y - p3y) + p3x * (p2y - p1y) >= 0
}

// spine-ts SkeletonClipping.makeClockwise（原地；平铺数组）
export function makeClockwise(verts: number[]): void {
  let n = verts.length
  let area = verts[n - 2] * verts[1] - verts[0] * verts[n - 1]
  for (let i = 0; i < n - 3; i += 2) {
    area += verts[i] * verts[i + 3] - verts[i + 2] * verts[i + 1]
  }
  if (area < 0) {
    return
  }
  let last = n - 2
  for (let i = 0; i < Math.floor(n / 2); i += 2) {
    let x = verts[i]
    let y = verts[i + 1]
    let o = last - i
    verts[i] = verts[o]
    verts[i + 1] = verts[o + 1]
    verts[o] = x
    verts[o + 1] = y
  }
}

function isConcave(index: number, vertexCount: number, verts: number[],
  indices: number[]): boolean {
  let prev = indices[(vertexCount + index - 1) % vertexCount]
  let cur = indices[index]
  let nxt = indices[(index + 1) % vertexCount]
  return !positiveArea(verts[prev * 2], verts[prev * 2 + 1],
    verts[cur * 2], verts[cur * 2 + 1],
    verts[nxt * 2], verts[nxt * 2 + 1])
}

// spine-ts Triangulator.triangulate（ear-clipping）→ 三角形顶点索引
function triangulatePolygon(verts: number[]): number[] {
  let vertexCount = Math.floor(verts.length / 2)
  let indices: number[] = []
  let concave: boolean[] = []
  for (let i = 0; i < vertexCount; i++) {
    indices.push(i)
    concave.push(false)
  }
  for (let i = 0; i < vertexCount; i++) {
    concave[i] = isConcave(i, vertexCount, verts, indices)
  }
  let triangles: number[] = []
  while (vertexCount > 3) {
    let previous = vertexCount - 1
    let i = 0
    let nxt = 1
    while (true) {
      let earOk = false
      if (!concave[i]) {
        let p1 = indices[previous]
        let p2 = indices[i]
        let p3 = indices[nxt]
        let p1x = verts[p1 * 2]
        let p1y = verts[p1 * 2 + 1]
        let p2x = verts[p2 * 2]
        let p2y = verts[p2 * 2 + 1]
        let p3x = verts[p3 * 2]
        let p3y = verts[p3 * 2 + 1]
        let blocked = false
        let ii = (nxt + 1) % vertexCount
        while (ii !== previous) {
          if (concave[ii]) {
            let v = indices[ii]
            let vx = verts[v * 2]
            let vy = verts[v * 2 + 1]
            if (positiveArea(p3x, p3y, p1x, p1y, vx, vy) &&
              positiveArea(p1x, p1y, p2x, p2y, vx, vy) &&
              positiveArea(p2x, p2y, p3x, p3y, vx, vy)) {
              blocked = true
              break
            }
          }
          ii = (ii + 1) % vertexCount
        }
        if (!blocked) {
          earOk = true
        }
      }
      if (earOk) {
        break
      }
      if (nxt === 0) {
        while (true) {
          if (!concave[i]) {
            break
          }
          i -= 1
          if (i <= 0) {
            break
          }
        }
        break
      }
      previous = i
      i = nxt
      nxt = (nxt + 1) % vertexCount
    }
    triangles.push(indices[(vertexCount + i - 1) % vertexCount])
    triangles.push(indices[i])
    triangles.push(indices[(i + 1) % vertexCount])
    indices.splice(i, 1)
    concave.splice(i, 1)
    vertexCount -= 1
    let prevIndex = (vertexCount + i - 1) % vertexCount
    let nextIndex = i !== vertexCount ? i : 0
    concave[prevIndex] = isConcave(prevIndex, vertexCount, verts, indices)
    concave[nextIndex] = isConcave(nextIndex, vertexCount, verts, indices)
  }
  if (vertexCount === 3) {
    triangles.push(indices[2])
    triangles.push(indices[0])
    triangles.push(indices[1])
  }
  return triangles
}

function winding(p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number): number {
  let px = p2x - p1x
  let py = p2y - p1y
  return p3x * py - p3y * px + px * p1y - p1x * py >= 0 ? 1 : -1
}

// spine-ts Triangulator.decompose：三角形合并为凸多边形（覆盖区域与三角形并集相同）
function decompose(verts: number[], triangles: number[]): number[][] {
  let convexPolys: number[][] = []
  let convexIndices: number[][] = []
  let polyIndices: number[] = []
  let polygon: number[] = []
  let fanBaseIndex = -1
  let lastWinding = 0
  for (let i = 0; i < triangles.length; i += 3) {
    let t1 = triangles[i] * 2
    let t2 = triangles[i + 1] * 2
    let t3 = triangles[i + 2] * 2
    let x1 = verts[t1]
    let y1 = verts[t1 + 1]
    let x2 = verts[t2]
    let y2 = verts[t2 + 1]
    let x3 = verts[t3]
    let y3 = verts[t3 + 1]
    let merged = false
    if (fanBaseIndex === t1) {
      let o = polygon.length - 4
      let w1 = winding(polygon[o], polygon[o + 1], polygon[o + 2], polygon[o + 3], x3, y3)
      let w2 = winding(x3, y3, polygon[0], polygon[1], polygon[2], polygon[3])
      if (w1 === lastWinding && w2 === lastWinding) {
        polygon.push(x3)
        polygon.push(y3)
        polyIndices.push(t3)
        merged = true
      }
    }
    if (!merged) {
      if (polygon.length > 0) {
        convexPolys.push(polygon)
        convexIndices.push(polyIndices)
      }
      polygon = [x1, y1, x2, y2, x3, y3]
      polyIndices = [t1, t2, t3]
      lastWinding = winding(x1, y1, x2, y2, x3, y3)
      fanBaseIndex = t1
    }
  }
  if (polygon.length > 0) {
    convexPolys.push(polygon)
    convexIndices.push(polyIndices)
  }
  // 第二循环：合并共享 (firstIndex, lastIndex) 边的三角形
  for (let i = 0; i < convexPolys.length; i++) {
    polyIndices = convexIndices[i]
    if (polyIndices.length === 0) {
      continue
    }
    let firstIndex = polyIndices[0]
    let lastIndex = polyIndices[polyIndices.length - 1]
    polygon = convexPolys[i]
    let o = polygon.length - 4
    let prevPrevX = polygon[o]
    let prevPrevY = polygon[o + 1]
    let prevX = polygon[o + 2]
    let prevY = polygon[o + 3]
    let firstX = polygon[0]
    let firstY = polygon[1]
    let secondX = polygon[2]
    let secondY = polygon[3]
    let w = winding(prevPrevX, prevPrevY, prevX, prevY, firstX, firstY)
    let ii = 0
    while (ii < convexPolys.length) {
      if (ii === i) {
        ii += 1
        continue
      }
      let otherIndices = convexIndices[ii]
      if (otherIndices.length !== 3) {
        ii += 1
        continue
      }
      if (otherIndices[0] !== firstIndex || otherIndices[1] !== lastIndex) {
        ii += 1
        continue
      }
      let otherPoly = convexPolys[ii]
      let x3 = otherPoly[otherPoly.length - 2]
      let y3 = otherPoly[otherPoly.length - 1]
      let w1 = winding(prevPrevX, prevPrevY, prevX, prevY, x3, y3)
      let w2 = winding(x3, y3, firstX, firstY, secondX, secondY)
      if (w1 === w && w2 === w) {
        convexPolys[ii] = []
        convexIndices[ii] = []
        polygon.push(x3)
        polygon.push(y3)
        polyIndices.push(otherIndices[2])
        prevPrevX = prevX
        prevPrevY = prevY
        prevX = x3
        prevY = y3
        ii = 0
      } else {
        ii += 1
      }
    }
  }
  let out: number[][] = []
  for (let i = 0; i < convexPolys.length; i++) {
    if (convexPolys[i].length > 0) {
      out.push(convexPolys[i])
    }
  }
  return out
}

// 裁剪附件世界顶点 → 官方语义的裁剪多边形列表（闭合 CW，骨架坐标）
export function clipAttachmentPolys(verts: number[]): number[][] {
  let v = verts.slice()
  makeClockwise(v)
  let tris = triangulatePolygon(v)
  let polys = decompose(v, tris)
  let out: number[][] = []
  for (let i = 0; i < polys.length; i++) {
    let p = polys[i]
    makeClockwise(p)
    p.push(p[0])
    p.push(p[1])
    out.push(p)
  }
  return out
}

// Sutherland-Hodgman：三角形（平铺 6 元素）与闭合裁剪多边形求交 → 未闭合平铺交点
function shClip(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
  clipArea: number[]): number[] {
  let inp: number[] = [x1, y1, x2, y2, x3, y3, x1, y1]
  let inpLen = 8
  let out: number[] = []
  let last = clipArea.length - 4
  let i = 0
  while (true) {
    let edgeX = clipArea[i]
    let edgeY = clipArea[i + 1]
    let edgeX2 = clipArea[i + 2]
    let edgeY2 = clipArea[i + 3]
    let deltaX = edgeX - edgeX2
    let deltaY = edgeY - edgeY2
    out = []
    let inputLen = inpLen - 2
    for (let ii = 0; ii < inputLen; ii += 2) {
      let inX = inp[ii]
      let inY = inp[ii + 1]
      let inX2 = inp[ii + 2]
      let inY2 = inp[ii + 3]
      let side2 = deltaX * (inY2 - edgeY2) - deltaY * (inX2 - edgeX2) > 0.0
      if (deltaX * (inY - edgeY2) - deltaY * (inX - edgeX2) > 0.0) {
        if (side2) {
          out.push(inX2)
          out.push(inY2)
          continue
        }
        let c0 = inY2 - inY
        let c2 = inX2 - inX
        let s = c0 * (edgeX2 - edgeX) - c2 * (edgeY2 - edgeY)
        if (Math.abs(s) > 0.000001) {
          let ua = (c2 * (edgeY - inY) - c0 * (edgeX - inX)) / s
          out.push(edgeX + (edgeX2 - edgeX) * ua)
          out.push(edgeY + (edgeY2 - edgeY) * ua)
        } else {
          out.push(edgeX)
          out.push(edgeY)
        }
      } else if (side2) {
        let c0 = inY2 - inY
        let c2 = inX2 - inX
        let s = c0 * (edgeX2 - edgeX) - c2 * (edgeY2 - edgeY)
        if (Math.abs(s) > 0.000001) {
          let ua = (c2 * (edgeY - inY) - c0 * (edgeX - inX)) / s
          out.push(edgeX + (edgeX2 - edgeX) * ua)
          out.push(edgeY + (edgeY2 - edgeY) * ua)
        } else {
          out.push(edgeX)
          out.push(edgeY)
        }
        out.push(inX2)
        out.push(inY2)
      }
    }
    if (out.length === 0) {
      return out
    }
    out.push(out[0])
    out.push(out[1])
    if (i === last) {
      break
    }
    inp = out
    inpLen = out.length
    i += 2
  }
  return out.slice(0, out.length - 2)
}

// 三角形（平铺 6）与全部裁剪多边形求交 → 交集多边形列表（pts + 重心插值 UV）
export function clipTriangleToPolys(tri: number[], uv: number[],
  polys: number[][]): ClippedTri[] {
  let x1 = tri[0]
  let y1 = tri[1]
  let x2 = tri[2]
  let y2 = tri[3]
  let x3 = tri[4]
  let y3 = tri[5]
  let u1 = uv[0]
  let v1 = uv[1]
  let u2 = uv[2]
  let v2 = uv[3]
  let u3 = uv[4]
  let v3 = uv[5]
  let d0 = y2 - y3
  let d1 = x3 - x2
  let d2 = x1 - x3
  let d4 = y3 - y1
  let denom = d0 * d2 + d1 * (y1 - y3)
  if (Math.abs(denom) < 1e-12) {
    return []
  }
  let inv = 1.0 / denom
  let results: ClippedTri[] = []
  for (let pi = 0; pi < polys.length; pi++) {
    let pts = shClip(x1, y1, x2, y2, x3, y3, polys[pi])
    if (pts.length < 6) {
      continue
    }
    let uvs: number[] = []
    for (let k = 0; k < pts.length; k += 2) {
      let px = pts[k]
      let py = pts[k + 1]
      let c0 = px - x3
      let c1 = py - y3
      let a = (d0 * c0 + d1 * c1) * inv
      let b = (d4 * c0 + d2 * c1) * inv
      let c = 1.0 - a - b
      uvs.push(u1 * a + u2 * b + u3 * c)
      uvs.push(v1 * a + v2 * b + v3 * c)
    }
    let r = new ClippedTri()
    r.pts = pts
    r.uvs = uvs
    results.push(r)
  }
  return results
}
