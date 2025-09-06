import { useEffect, useRef, useState } from 'react'
import {
  RenderingEngine,
  Enums,
  type Types,
  getRenderingEngine,
  setUseCPURendering,
} from '@cornerstonejs/core'
import { initCornerstone } from './cornerstoneInit'

const VIEWPORT_ID = 'VP'
const ENGINE_ID = 'ENGINE'
const SERIES_BASE = `${window.location.origin}/series/cranial/`
const UID_PREFIX = '1.3.6.1.4.1.5962.99.1.2786334768.1849416866.1385765836848.'
const UID_SUFFIX = '.0.dcm'
const START = 150
const END = 375

const imageIds = Array.from({ length: END - START + 1 }, (_, i) => {
  const idx = START + i
  const fname = `${UID_PREFIX}${idx}${UID_SUFFIX}`
  return `wadouri:${SERIES_BASE}${encodeURIComponent(fname)}`
})

export default function Viewer() {
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IStackViewport | null>(null)

  const [index, setIndex] = useState(0)
  const total = imageIds.length
  const [invert, setInvert] = useState(false)  
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  
  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        await initCornerstone()
        if (destroyed) return
        setUseCPURendering(true)

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
        await raf()

        const vp = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport
        vpRef.current = vp

        await vp.setStack(imageIds)
        await vp.setImageIdIndex(index)
        vp.resetCamera()
        vp.setProperties({ invert })
        vp.render()

        setReady(true)
        setError(null)
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()
    return () => { destroyed = true }
  }, [])


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


  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const clamp = (i: number) => Math.max(0, Math.min(total - 1, i))

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY > 0 ? 1 : -1
      setIndex((i) => clamp(i + step))
    }

    const onKey = (e: KeyboardEvent) => {
      if (!el.matches(':hover')) return
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); setIndex((i) => clamp(i - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); setIndex((i) => clamp(i + 1))
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

          <div style={{ color: '#888' }}>
            {ready ? 'Stack loaded' : 'Loading…'}
            {error && <span style={{ color: 'tomato' }}> — Error: {error}</span>}
          </div>
        </div>

        {/* Right fixed box for Cornerstone */}
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
