# Medical3D Imaging Viewer (React + Cornerstone3D)

A minimal React + TypeScript app that renders medical images in two classic ways using **Cornerstone3D**:

- **Stack Viewer** — traditional 2D slice-by-slice viewing.
- **MPR (Axial) Viewer** — orthographic **volume** rendering (multi-planar reformat) through the axial plane.

Both views share the same UI (invert toggle, **vertical slice slider on the right**, wheel/keyboard scroll) and a **single shared WebGL engine** for stability and performance.

---

## Frontend – React (Vite + TypeScript)

### Requirements
- **Node.js 18+**
- A modern browser with **WebGL2** enabled
- DICOM files reachable via HTTP (WADO-URI) from the same origin (or with proper CORS)

### Install

```npm install```
```npm run dev```
