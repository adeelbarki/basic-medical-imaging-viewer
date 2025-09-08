import { useEffect, useRef, useState } from 'react'
import {
  RenderingEngine,
  Enums,
  type Types,
  getRenderingEngine,
} from '@cornerstonejs/core'
import { initCornerstone } from './cornerstoneInit'
import './StackViewer.css'

type Props = { imageIds: string[] }

const VIEWPORT_ID = 'VP_STACK'
const ENGINE_ID = 'ENGINE_STACK'

export default function StackViewer({ imageIds }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IStackViewport | null>(null)

  const [index, setIndex] = useState(0)
  const [invert, setInvert] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = imageIds.length
  const clamp = (i: number) => Math.max(0, Math.min(total - 1, i))

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

        try {
          const existing = engine.getViewport(VIEWPORT_ID)
          if (existing) engine.disableElement(VIEWPORT_ID)
        } catch {}

        engine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.STACK,
          element,
          defaultOptions: { background: [0, 0, 0] },
        })

        const vp = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport
        vpRef.current = vp

        await vp.setStack(imageIds)
        await vp.setImageIdIndex(index)
        vp.setProperties({ invert })
        vp.resetCamera()
        vp.render()

        setReady(true)
        setError(null)
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()
    return () => { 
      destroyed = true 
      const eng = engineRef.current
      if (eng) {
        try { eng.disableElement('VP_STACK') } catch {}
        try { eng.destroy() } catch {}
        engineRef.current = null
      }
    }
  }, [imageIds])

  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    try { vp.setProperties({ invert }); vp.render() } catch {}
  }, [invert])

  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    ;(async () => {
      try {
        await vp.setImageIdIndex(index)
        vp.render()
      } catch (e) {
        console.error(e)
      }
    })()
  }, [index])

  return (
    <div className={`stack-viewer${invert ? ' invert' : ''}`}>
      <div className="stack-viewer__header">
        <div className="stack-viewer__title">Slice: {index + 1} / {total}</div>
        <label className="stack-viewer__checkboxLabel">
          <input
            type="checkbox"
            checked={invert}
            onChange={e => setInvert(e.target.checked)}
          /> Invert
        </label>
      </div>

      <div className="stack-viewer__viewportWrap">
        <div ref={elRef} className="stack-viewer__viewport" tabIndex={0} />

        <input
          className="stack-viewer__slider"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={(total - 1) - index}
          onChange={(e) => {
            const v = Number(e.target.value)
            setIndex(clamp((total - 1) - v))
          }}
        />
      </div>

      <div className="stack-viewer__status">
        {error && <span className="stack-viewer__error">Error: {error}</span>}
      </div>
    </div>
  )
}
