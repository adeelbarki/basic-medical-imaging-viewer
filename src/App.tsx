
import './App.css'
import Viewer from './Viewer'
// import ViewerThreeD from './ViewerThreeD'

function App() {

  return (
    <div style={{ paddingLeft: 1, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h3 style={{ paddingLeft: 40, marginBottom: 8 }}>Cornerstone3D Minimal (React)</h3>
      <Viewer />
    </div>
  )
}

export default App
