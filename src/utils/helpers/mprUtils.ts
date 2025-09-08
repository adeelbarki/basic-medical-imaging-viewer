// src/utils/mprUtils.ts
import { metaData, imageLoader } from '@cornerstonejs/core'

/* ---------- tiny helpers ---------- */
export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export function raf() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()))
}

/**
 * Ensure imagePlaneModule (IPP/IOP) is cached for each imageId.
 * Helpful when MPR is opened directly without viewing the stack first.
 */
export async function prefetchPlaneMeta(ids: string[]) {
  const missing: string[] = []
  for (const id of ids) {
    const plane = metaData.get('imagePlaneModule', id) as any
    if (!plane) missing.push(id)
  }
  if (!missing.length) return

  const BATCH = 8
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH)
    await Promise.allSettled(chunk.map((id) => imageLoader.loadAndCacheImage(id)))
  }
}

/**
 * Build a consistent, sorted slice list for MPR:
 *  - filters images that have valid IPP/IOP
 *  - groups by orientation
 *  - picks the largest group (≥ 3)
 *  - sorts along slice normal
 */
export function buildMprImageIds(
  ids: string[]
): { goodIds: string[]; reason?: string } {
  type Plane = { imageId: string; ipp: number[]; row: number[]; col: number[] }
  const planes: Plane[] = []

  for (const id of ids) {
    const plane = metaData.get('imagePlaneModule', id) as any
    const ipp = plane?.imagePositionPatient
    const iop = plane?.imageOrientationPatient
    if (Array.isArray(ipp) && ipp.length === 3 && Array.isArray(iop) && iop.length === 6) {
      const row = [iop[0], iop[1], iop[2]]
      const col = [iop[3], iop[4], iop[5]]
      planes.push({ imageId: id, ipp, row, col })
    }
  }

  if (planes.length < 3) {
    return { goodIds: [], reason: 'Too few slices with geometry (IPP/IOP).' }
  }

  const groups: Plane[][] = []
  const used = new Array(planes.length).fill(false)
  const EPS = 1e-3

  for (let i = 0; i < planes.length; i++) {
    if (used[i]) continue
    const g: Plane[] = [planes[i]]
    used[i] = true
    for (let j = i + 1; j < planes.length; j++) {
      if (used[j]) continue
      if (sameOrientation(planes[i], planes[j], EPS)) {
        g.push(planes[j])
        used[j] = true
      }
    }
    groups.push(g)
  }

  groups.sort((a, b) => b.length - a.length)
  const main = groups[0]
  if (!main || main.length < 3) {
    return { goodIds: [], reason: 'No consistent orientation group with ≥3 slices.' }
  }

  const normal = cross(main[0].row, main[0].col)
  main.sort((a, b) => dot(a.ipp, normal) - dot(b.ipp, normal))
  return { goodIds: main.map((p) => p.imageId) }
}

/* ---------- vector math & orientation ---------- */
export function sameOrientation(
  a: { row: number[]; col: number[] },
  b: { row: number[]; col: number[] },
  eps: number
) {
  return (
    (nearlyEqualVec(a.row, b.row, eps) && nearlyEqualVec(a.col, b.col, eps)) ||
    (nearlyEqualVec(a.row, [-b.row[0], -b.row[1], -b.row[2]], eps) &&
      nearlyEqualVec(a.col, [-b.col[0], -b.col[1], -b.col[2]], eps))
  )
}

export function nearlyEqualVec(a: number[], b: number[], eps: number) {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  )
}

export function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
