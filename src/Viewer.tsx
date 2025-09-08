import { useMemo, useState } from 'react'
import StackViewer from './StackViewer'
import MprAxialViewer from './MprAxialViewer'
import ViewerThreeD from './ViewerThreeD' // <-- new 3D viewer

const SERIES_BASE = `${window.location.origin}/series/cranial/`
const UID_PREFIX = '1.3.6.1.4.1.5962.99.1.2786334768.1849416866.1385765836848.'
const UID_SUFFIX = '.0.dcm'
const START = 150
const END = 375

type Tab = 'stack' | 'mpr' | '3d'

function seriesBaseFix(base: string) {
  return base.endsWith('/') ? base : base + '/'
}

export default function Viewer() {
  const [tab, setTab] = useState<Tab>('stack')

  const imageIds = useMemo(() => {
    const base = seriesBaseFix(SERIES_BASE)
    return Array.from({ length: END - START + 1 }, (_, i) => {
      const idx = START + i
      const fname = `${UID_PREFIX}${idx}${UID_SUFFIX}`
      return `wadouri:${base}${encodeURIComponent(fname)}`
    })
  }, [])

  const tabBtnStyle = (active: boolean) => ({
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #333',
    background: active ? '#2a2a2a' : '#161616',
    color: '#ddd',
    cursor: 'pointer',
  } as const)

  return (
    <div style={{ 
          color: '#ddd', width: '100%', padding: 16, 
          display: 'grid', 
          gridTemplateRows: 'auto 1fr',
          gap: 12,
      }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setTab('stack')} style={tabBtnStyle(tab === 'stack')}>
          Stack Viewer
        </button>
        <button onClick={() => setTab('mpr')} style={tabBtnStyle(tab === 'mpr')}>
          MPR (Axial) Viewer
        </button>
        <button onClick={() => setTab('3d')} style={tabBtnStyle(tab === '3d')}>
          3D Volume
        </button>
      </div>

      <div style={{ display: 'grid', gap: 24, minHeight: 0 }}>
        {tab === 'stack' && <StackViewer imageIds={imageIds} />}
        {tab === 'mpr' && <MprAxialViewer imageIds={imageIds} />}
        {tab === '3d' && <ViewerThreeD imageIds={imageIds} />}
      </div>
    </div>
  )
}
