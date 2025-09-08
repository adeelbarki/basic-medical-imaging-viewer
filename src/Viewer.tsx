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
} from '@cornerstonejs/core'

import { initCornerstone } from './cornerstoneInit'

const VIEWPORT_ID = 'VP'
const ENGINE_ID = 'ENGINE'
const VOLUME_ID = 'cornerstoneStreamingImageVolume:cranial'

const SERIES_BASE = `${window.location.origin}/series/cranial/`
const UID_PREFIX = '1.3.6.1.4.1.5962.99.1.2786334768.1849416866.1385765836848.'
const UID_SUFFIX = '.0.dcm'
const START = 150
const END = 375

const imageIds = Array.from({ length: END - START + 1 }, (_, i) => {
  const idx = START + i
  const fname = `${UID_PREFIX}${idx}${UID_SUFFIX}`
  return `wadouri:${SEREIS_BASE_FIX(SERIES_BASE)}${encodeURIComponent(fname)}`
})

export default function Viewer() {
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IStackViewport | Types.IVolumeViewport | null>(null)

  const [index, setIndex] = useState(0)
  const total = imageIds.length
  const [invert, setInvert] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mpr, setMpr] = useState(false)

  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        await initCornerstone()
        if (destroyed) return

        let engine = getRenderingEngine(ENGINE_ID) as RenderingEngine | undefined
        if (!engineRef.current) engineRef.current = engine ?? new RenderingEngine(ENGINE_ID)
        engine = engineRef.current

        const element = elRef.current
        if (!element) throw new Error('Viewport element not mounted')

        const enable = async () => {
          try {
            const existing = engine!.getViewport(VIEWPORT_ID)
            if (existing) engine!.disableElement(VIEWPORT_ID)
          } catch {}

          if (!mpr) {
            // ---------- STACK ----------
            setUseCPURendering(true)
            engine!.enableElement({
              viewportId: VIEWPORT_ID,
              type: Enums.ViewportType.STACK,
              element,
              defaultOptions: { background: [0, 0, 0] },
            })
            await raf()

            const vp = engine!.getViewport(VIEWPORT_ID) as Types.IStackViewport
            vpRef.current = vp
            await vp.setStack(imageIds)
            await vp.setImageIdIndex(index)
            vp.setProperties({ invert })
            vp.resetCamera()
            vp.render()
            setError(null)
          } else {
            // ---------- MPR ----------
            setUseCPURendering(false)

            // Filter & sort valid slices (IPP/IOP) for a consistent orientation
            const { goodIds, reason } = buildMprImageIds(imageIds)
            if (goodIds.length < 3) {
              setMpr(false)
              setError(
                reason ??
                  'MPR disabled: insufficient consistent geometric slices. Showing stack view.'
              )
              // fallback to stack immediately
              setUseCPURendering(true)
              engine!.enableElement({
                viewportId: VIEWPORT_ID,
                type: Enums.ViewportType.STACK,
                element,
                defaultOptions: { background: [0, 0, 0] },
              })
              await raf()
              const svp = engine!.getViewport(VIEWPORT_ID) as Types.IStackViewport
              vpRef.current = svp
              await svp.setStack(imageIds)
              await svp.setImageIdIndex(index)
              svp.setProperties({ invert })
              svp.resetCamera()
              svp.render()
              setReady(true)
              return
            }

            const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds: goodIds })
            await volume.load()

            engine!.enableElement({
              viewportId: VIEWPORT_ID,
              type: Enums.ViewportType.ORTHOGRAPHIC,
              element,
              defaultOptions: { background: [0, 0, 0] },
            })
            await raf()

            const vvp = engine!.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
            vpRef.current = vvp

            await vvp.setVolumes([{ volumeId: VOLUME_ID }])
            vvp.setOrientation(Enums.OrientationAxis.AXIAL)
            vvp.setProperties({ invert })
            vvp.resetCamera()
            vvp.render()
            await raf() // let slice context init

            // Use robust scroll (delta) instead of jumpToSlice
            try {
              const { numberOfSlices, imageIndex } =
                utilities.getImageSliceDataForVolumeViewport(vvp)
              if (!numberOfSlices) throw new Error('Slice context not initialized')
              const target = clamp(index, 0, numberOfSlices - 1)
              const delta = target - imageIndex
              if (delta !== 0) await utilities.scroll(vvp, { delta })
              vvp.render()
              setError(null)
            } catch (e: any) {
              // if anything odd, just ensure camera is centered and render
              vvp.resetCamera()
              vvp.render()
              setError('MPR loaded with irregular spacing; scrolling normalized.')
            }
          }

          setReady(true)
        }

        await enable()
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()
    return () => {
      destroyed = true
    }
  }, [mpr])

  // Apply invert to active viewport
  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    try {
      vp.setProperties({ invert })
      vp.render()
    } catch {}
  }, [invert])

  // Slice/Index changes
  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    ;(async () => {
      try {
        if (!mpr) {
          setUseCPURendering(true)
          const svp = vp as Types.IStackViewport
          await svp.setImageIdIndex(index)
          svp.render()
        } else {
          const vvp = vp as Types.IVolumeViewport
          const info = utilities.getImageSliceDataForVolumeViewport(vvp)
          if (!info?.numberOfSlices) return
          const target = clamp(index, 0, info.numberOfSlices - 1)
          const delta = target - info.imageIndex
          if (delta !== 0) await utilities.scroll(vvp, { delta })
          vvp.render()
        }
      } catch (e) {
        console.error(e)
      }
    })()
  }, [index, mpr])

  // Wheel/keyboard controls
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const clampIdx = (i: number) => clamp(i, 0, total - 1)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY > 0 ? 1 : -1
      setIndex((i) => clampIdx(i + step))
    }

    const onKey = (e: KeyboardEvent) => {
      if (!el.matches(':hover')) return
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); setIndex((i) => clampIdx(i - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); setIndex((i) => clampIdx(i + 1))
      } else if (e.key === 'Home') {
        e.preventDefault(); setIndex(0)
      } else if (e.key === 'End') {
        e.preventDefault(); setIndex(total - 1)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [total])

  return (
    <div style={{ color: '#ddd', width: '100%' }}>
      <div style={{ width: '100%', margin: '0 auto', padding: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '350px 1500px',
            gap: 16,
            alignItems: 'stretch',
            justifyContent: 'center',
          }}
        >
          {/* Left controls */}
          <div style={{ background: '#1f1f1f', padding: 12, borderRadius: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <label>Slice: {index + 1} / {total}</label>
              <input
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={() => setIndex(0)}>First</button>
                <button onClick={() => setIndex((i) => Math.max(0, i - 1))}>Prev</button>
                <button onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>Next</button>
                <button onClick={() => setIndex(total - 1)}>Last</button>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => setInvert(e.target.checked)}
                />{' '}
                Invert
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={mpr}
                  onChange={(e) => setMpr(e.target.checked)}
                />{' '}
                MPR (axial)
              </label>
            </div>

            <div style={{ color: '#888' }}>
              {ready ? (mpr ? 'MPR loaded' : 'Stack loaded') : 'Loading…'}
              {error && <span style={{ color: 'tomato' }}> — {error}</span>}
            </div>
          </div>

          {/* Right: Cornerstone element */}
          <div
            style={{
              background: '#0d0d0d',
              borderRadius: 12,
              width: '100%',
              height: '80vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              ref={elRef}
              style={{
                width: '100%',
                height: '100%',
                background: '#111',
                borderRadius: 12,
              }}
              tabIndex={0}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function raf() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()))
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

// fix accidental line-breaks or trailing slashes in SERIES_BASE
function SEREIS_BASE_FIX(base: string) {
  return base.endsWith('/') ? base : base + '/'
}

/**
 * Build a robust list of imageIds for MPR:
 * - keep only slices that have IPP & IOP
 * - group by (rowCosines, colCosines) and keep the largest group (consistent orientation)
 * - sort by position along the slice normal
 */
function buildMprImageIds(ids: string[]): { goodIds: string[]; reason?: string } {
  type Plane = { imageId: string; ipp: number[]; row: number[]; col: number[] }

  const planes: Plane[] = []
  for (const id of ids) {
    const plane = metaData.get('imagePlaneModule', id) as any
    const ipp = plane?.imagePositionPatient
    const iop = plane?.imageOrientationPatient
    if (
      Array.isArray(ipp) && ipp.length === 3 &&
      Array.isArray(iop) && iop.length === 6
    ) {
      const row = [iop[0], iop[1], iop[2]]
      const col = [iop[3], iop[4], iop[5]]
      planes.push({ imageId: id, ipp, row, col })
    }
  }

  if (planes.length < 3) {
    return { goodIds: [], reason: 'Too few slices with geometry (IPP/IOP).' }
  }

  // Group by orientation (row/col) using a tolerance
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
        g.push(planes[j]); used[j] = true
      }
    }
    groups.push(g)
  }

  // Largest consistent-orientation group
  groups.sort((a, b) => b.length - a.length)
  const main = groups[0]
  if (!main || main.length < 3) {
    return { goodIds: [], reason: 'No consistent orientation group with ≥3 slices.' }
  }

  // Sort by dot(IPP, normal) where normal = row × col
  const normal = cross(main[0].row, main[0].col)
  main.sort((a, b) => dot(a.ipp, normal) - dot(b.ipp, normal))

  return { goodIds: main.map(p => p.imageId) }
}

function sameOrientation(a: {row:number[];col:number[]}, b: {row:number[];col:number[]}, eps: number) {
  return (
    nearlyEqualVec(a.row, b.row, eps) && nearlyEqualVec(a.col, b.col, eps)
  ) || (
    // allow flipped normal: (row, col) ~ (-row, -col)
    nearlyEqualVec(a.row, [-b.row[0], -b.row[1], -b.row[2]], eps) &&
    nearlyEqualVec(a.col, [-b.col[0], -b.col[1], -b.col[2]], eps)
  )
}

function nearlyEqualVec(a: number[], b: number[], eps: number) {
  return Math.abs(a[0]-b[0]) < eps &&
         Math.abs(a[1]-b[1]) < eps &&
         Math.abs(a[2]-b[2]) < eps
}

function cross(a: number[], b: number[]) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ]
}

function dot(a: number[], b: number[]) {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
}
