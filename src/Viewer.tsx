import { useMemo, useState } from 'react'
import StackViewer from './StackViewer'
import MprAxialViewer from './MprAxialViewer'

const SERIES_BASE = `${window.location.origin}/series/cranial/`
const UID_PREFIX = '1.3.6.1.4.1.5962.99.1.2786334768.1849416866.1385765836848.'
const UID_SUFFIX = '.0.dcm'
const START = 150
const END = 375

function seriesBaseFix(base: string) {
  return base.endsWith('/') ? base : base + '/'
}

export default function Viewer() {
  const [tab, setTab] = useState<'stack' | 'mpr'>('stack')
  const imageIds = useMemo(() => {
    const base = seriesBaseFix(SERIES_BASE)
    return Array.from({ length: END - START + 1 }, (_, i) => {
      const idx = START + i
      const fname = `${UID_PREFIX}${idx}${UID_SUFFIX}`
      return `wadouri:${base}${encodeURIComponent(fname)}`
    })
  }, [])

  return (
    <div style={{ color: '#ddd', width: '100%', padding: 16, display: 'grid' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setTab('stack')}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #333',
            background: tab === 'stack' ? '#2a2a2a' : '#161616',
            color: '#ddd',
            cursor: 'pointer',
          }}
        >
          Stack Viewer
        </button>
        <button
          onClick={() => setTab('mpr')}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #333',
            background: tab === 'mpr' ? '#2a2a2a' : '#161616',
            color: '#ddd',
            cursor: 'pointer',
          }}
        >
          MPR (Axial) Viewer
        </button>
        </div>
        <div style={{ display: 'grid', gap: 24 }}>
          {tab === 'stack' ? (
            <StackViewer imageIds={imageIds} />
            ) : (
            <MprAxialViewer imageIds={imageIds} />
          )}
        </div>
    </div>
  )
}
