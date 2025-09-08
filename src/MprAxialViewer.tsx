import { useEffect, useRef, useState } from 'react'
import {
  RenderingEngine,
  Enums,
  type Types,
  getRenderingEngine,
  setUseCPURendering,
  utilities,
  volumeLoader,
  metaData,
  imageLoader,
} from '@cornerstonejs/core'
import { initCornerstone } from './cornerstoneInit'

type Props = { imageIds: string[] }

const ENGINE_ID = 'ENGINE_SHARED'                 // reuse one WebGL engine across tabs
const VIEWPORT_ID = 'VP_MPR'
const VOLUME_ID_BASE = 'cornerstoneStreamingImageVolume:cranial-mpr'

export default function MprAxialViewer({ imageIds }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IVolumeViewport | null>(null)

  const [index, setIndex] = useState(0)
  const [invert, setInvert] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numSlices, setNumSlices] = useState(0)

  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        await initCornerstone()
        if (destroyed) return

        // Always GPU for volume viewports
        setUseCPURendering(false)

        // Reuse a single engine/context
        const engine = getRenderingEngine(ENGINE_ID) ?? new RenderingEngine(ENGINE_ID)
        engineRef.current = engine

        const element = elRef.current
        if (!element) throw new Error('Viewport element not mounted')

        // Prefetch metadata so IPP/IOP is available even if Stack tab wasn't used
        await prefetchPlaneMeta(imageIds)

        // Filter & sort coherent set (same rule you used for working MPR)
        const { goodIds, reason } = buildMprImageIds(imageIds)
        if (goodIds.length < 3) {
          setError(reason ?? 'Insufficient geometric slices for MPR.')
          setReady(true)
          return
        }

        // Clean old viewport & enable orthographic viewport
        try { engine.disableElement(VIEWPORT_ID) } catch {}
        engine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element,
          defaultOptions: { background: [0, 0, 0] },
        })
        await raf()

        // Create volume and attach
        const VOLUME_ID = `${VOLUME_ID_BASE}-${goodIds.length}`
        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds: goodIds })
        await volume.load()

        const vvp = engine.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
        vpRef.current = vvp

        await vvp.setVolumes([{ volumeId: VOLUME_ID }])
        vvp.setOrientation(Enums.OrientationAxis.AXIAL)
        vvp.setProperties({ invert })
        vvp.resetCamera()
        vvp.render()

        // Initialize slice context, then scroll to current index
        await raf()
        const { numberOfSlices, imageIndex } = utilities.getImageSliceDataForVolumeViewport(vvp)
        const n = numberOfSlices ?? 0
        setNumSlices(n)

        const target = clamp(index, 0, Math.max(0, n - 1))
        const delta = target - (imageIndex ?? 0)
        if (delta !== 0) await utilities.scroll(vvp, { delta })
        vvp.render()

        setError(null)
        setReady(true)
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()

    // Cleanup: only disable this viewport (keep shared engine alive)
    return () => {
      destroyed = true
      const eng = engineRef.current
      if (eng) {
        try { eng.disableElement(VIEWPORT_ID) } catch {}
      }
      vpRef.current = null
    }
  }, [imageIds])

  // Invert toggle
  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    try { vp.setProperties({ invert }); vp.render() } catch {}
  }, [invert])

  // Index change → scroll using slice context
  useEffect(() => {
    const vp = vpRef.current
    if (!vp || numSlices < 1) return
    ;(async () => {
      try {
        const { numberOfSlices, imageIndex } = utilities.getImageSliceDataForVolumeViewport(vp)
        const n = numberOfSlices ?? numSlices
        const target = clamp(index, 0, Math.max(0, n - 1))
        const delta = target - (imageIndex ?? 0)
        if (delta !== 0) await utilities.scroll(vp, { delta })
        vp.render()
      } catch (e) {
        console.error(e)
      }
    })()
  }, [index, numSlices])

  const totalShown = Math.max(1, numSlices)
  const clampIdx = (i: number) => clamp(i, 0, totalShown - 1)

  return (
    <div className={`stack-viewer${invert ? ' invert' : ''}`}>
      <div className="stack-viewer__header">
        <div className="stack-viewer__title">Slice: {index + 1} / {totalShown}</div>
        <label className="stack-viewer__checkboxLabel">
          <input
            type="checkbox"
            checked={invert}
            onChange={e => setInvert(e.target.checked)}
          /> Invert
        </label>
      </div>

      <div className="stack-viewer__viewportWrap">
        {/* Cornerstone element */}
        <div ref={elRef} className="stack-viewer__viewport" tabIndex={0} />

        {/* Vertical slice slider on the right (same as Stack) */}
        <input
          className="stack-viewer__slider"
          type="range"
          min={0}
          max={Math.max(0, totalShown - 1)}
          value={(totalShown - 1) - index}
          onChange={(e) => {
            const v = Number(e.target.value)
            setIndex(clampIdx((totalShown - 1) - v))
          }}
        />
      </div>

      <div className="stack-viewer__status">
        {error && <span className="stack-viewer__error">Error: {error}</span>}
        {!error && !ready && <span className="stack-viewer__loading">Loading…</span>}
      </div>
    </div>
  )
}

/* ---------------- helpers ---------------- */

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }
function raf() { return new Promise<void>((r) => requestAnimationFrame(() => r())) }

async function prefetchPlaneMeta(ids: string[]) {
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

/** Same filter/sort logic you used before */
function buildMprImageIds(ids: string[]): { goodIds: string[]; reason?: string } {
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
  if (planes.length < 3) return { goodIds: [], reason: 'Too few slices with geometry (IPP/IOP).' }

  const groups: Plane[][] = []
  const used = new Array(planes.length).fill(false)
  const EPS = 1e-3
  for (let i = 0; i < planes.length; i++) {
    if (used[i]) continue
    const g: Plane[] = [planes[i]]
    used[i] = true
    for (let j = i + 1; j < planes.length; j++) {
      if (used[j]) continue
      if (sameOrientation(planes[i], planes[j], EPS)) { g.push(planes[j]); used[j] = true }
    }
    groups.push(g)
  }

  groups.sort((a, b) => b.length - a.length)
  const main = groups[0]
  if (!main || main.length < 3) return { goodIds: [], reason: 'No consistent orientation group with ≥3 slices.' }

  const normal = cross(main[0].row, main[0].col)
  main.sort((a, b) => dot(a.ipp, normal) - dot(b.ipp, normal))
  return { goodIds: main.map(p => p.imageId) }
}
function sameOrientation(a: {row:number[];col:number[]}, b: {row:number[];col:number[]}, eps: number) {
  return (nearlyEqualVec(a.row, b.row, eps) && nearlyEqualVec(a.col, b.col, eps)) ||
         (nearlyEqualVec(a.row, [-b.row[0], -b.row[1], -b.row[2]], eps) && nearlyEqualVec(a.col, [-b.col[0], -b.col[1], -b.col[2]], eps))
}
function nearlyEqualVec(a: number[], b: number[], eps: number) { return Math.abs(a[0]-b[0]) < eps && Math.abs(a[1]-b[1]) < eps && Math.abs(a[2]-b[2]) < eps }
function cross(a: number[], b: number[]) { return [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ] }
function dot(a: number[], b: number[]) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
