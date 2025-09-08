// src/MprAxialViewer.tsx
import { useEffect, useRef, useState } from 'react'
import {
  RenderingEngine,
  Enums,
  type Types,
  getRenderingEngine,
  setUseCPURendering,
  utilities,
  volumeLoader,
} from '@cornerstonejs/core'
import { initCornerstone } from './cornerstoneInit'
import {
  clamp,
  raf,
  prefetchPlaneMeta,
  buildMprImageIds,
} from './utils/helpers/mprUtils'

type Props = { imageIds: string[] }

const ENGINE_ID = 'ENGINE_SHARED'
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

        setUseCPURendering(false)

        const engine =
          getRenderingEngine(ENGINE_ID) ?? new RenderingEngine(ENGINE_ID)
        engineRef.current = engine

        const element = elRef.current
        if (!element) throw new Error('Viewport element not mounted')

        await prefetchPlaneMeta(imageIds)

        const { goodIds, reason } = buildMprImageIds(imageIds)
        if (goodIds.length < 3) {
          setError(reason ?? 'Insufficient geometric slices for MPR.')
          setReady(true)
          return
        }

        try {
          engine.disableElement(VIEWPORT_ID)
        } catch {}

        engine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element,
          defaultOptions: { background: [0, 0, 0] },
        })
        await raf()

        const VOLUME_ID = `${VOLUME_ID_BASE}-${goodIds.length}`
        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, {
          imageIds: goodIds,
        })
        await volume.load()

        const vvp = engine.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
        vpRef.current = vvp

        await vvp.setVolumes([{ volumeId: VOLUME_ID }])
        vvp.setOrientation(Enums.OrientationAxis.AXIAL)
        vvp.setProperties({ invert })
        vvp.resetCamera()
        vvp.render()

        await raf()
        const { numberOfSlices, imageIndex } =
          utilities.getImageSliceDataForVolumeViewport(vvp)
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

    return () => {
      destroyed = true
      const eng = engineRef.current
      if (eng) {
        try {
          eng.disableElement(VIEWPORT_ID)
        } catch {}
      }
      vpRef.current = null
    }
  }, [imageIds])

  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    try {
      vp.setProperties({ invert })
      vp.render()
    } catch {}
  }, [invert])

  useEffect(() => {
    const vp = vpRef.current
    if (!vp || numSlices < 1) return
    ;(async () => {
      try {
        const { numberOfSlices, imageIndex } =
          utilities.getImageSliceDataForVolumeViewport(vp)
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
        <div className="stack-viewer__title">
          Slice: {index + 1} / {totalShown}
        </div>
        <label className="stack-viewer__checkboxLabel">
          <input
            type="checkbox"
            checked={invert}
            onChange={(e) => setInvert(e.target.checked)}
          />{' '}
          Invert
        </label>
      </div>

      <div className="stack-viewer__viewportWrap">
        <div ref={elRef} className="stack-viewer__viewport" tabIndex={0} />
        <input
          className="stack-viewer__slider"
          type="range"
          min={0}
          max={Math.max(0, totalShown - 1)}
          value={totalShown - 1 - index}
          onChange={(e) => {
            const v = Number(e.target.value)
            setIndex(clampIdx(totalShown - 1 - v))
          }}
        />
      </div>

      <div className="stack-viewer__status">
        {error && <span className="stack-viewer__error">Error: {error}</span>}
        {!error && !ready && (
          <span className="stack-viewer__loading">Loading…</span>
        )}
      </div>
    </div>
  )
}
