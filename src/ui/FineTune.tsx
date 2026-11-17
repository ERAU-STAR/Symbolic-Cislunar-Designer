import { useEffect, useRef, useState } from 'react';
import type { Piece } from '../core/boundary';
import type { Slice } from '../core/icmap';
import { displayIndex, type MapState } from '../core/mapEngine';
import type { Legend } from './palette';
import type { Pick } from './MapScreen';

export interface MapView { state: MapState; legend: Legend }

// step = 10^e deg for angles and 10^(e-2) for lengths [ndim]; presets coarse / medium / fine = e 0 / -1 / -2
const PRESETS = { coarse: 0, medium: -1, fine: -2 } as const;
type StepKey = keyof typeof PRESETS;
const keepStep = { e: -1 };

/** number field that commits on Enter / blur (typing does not re-propagate on every key) */
function NumField({ value, dec, onCommit }: { value: number; dec: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = useState(value.toFixed(dec));
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (!edit) setTxt(value.toFixed(dec)); }, [value, dec, edit]);
  const commit = () => { setEdit(false); const v = parseFloat(txt); if (Number.isFinite(v) && v !== value) onCommit(v); else setTxt(value.toFixed(dec)); };
  return <input className="numf" type="text" inputMode="decimal" value={txt} onFocus={() => setEdit(true)} onChange={(e) => setTxt(e.target.value)}
    onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(value.toFixed(dec)); setEdit(false); } }} />;
}

/** Mini symbolic map around the chosen point + nudge controls; every change re-propagates at once. */
export function FineTune({ pick, setPick, piece, map, slice, setSlice, onZoomMap }: {
  pick: Pick; setPick: (p: Pick) => void; piece: Piece; map: MapView | null;
  slice: Slice; setSlice: (s: Slice) => void; onZoomMap: (span1: number, span2: number) => void;
}) {
  const [zoom, setZoom] = useState(4);
  const [e10, setE10S] = useState(keepStep.e);
  const setE10 = (e: number) => { keepStep.e = e; setE10S(e); };
  const cv = useRef<HTMLCanvasElement>(null);
  const S = 220;
  const win = map?.state.p.win;
  const span1 = win ? (win.p1b - win.p1a) / zoom : 1, span2 = win ? (win.p2b - win.p2a) / zoom : 1;
  const zp = map?.state.p.axes === 'zpsi3'; // mini map over (z, psi3) at the fixed section point
  const ctr = zp ? { a: slice.z, b: slice.psi3 } : { a: pick.psi1, b: pick.psi2 };
  const v0 = { a: ctr.a - span1 / 2, b: ctr.b - span2 / 2 };

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = S * dpr; c.height = S * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#eef0f3'; g.fillRect(0, 0, S, S);
    if (map && win) {
      const st = map.state, n = st.n1, N = 110, img = new ImageData(N, N);
      for (let q = 0; q < N; q++) for (let r = 0; r < N; r++) {
        const s1 = v0.a + ((q + 0.5) / N) * span1, s2 = v0.b + ((N - r - 0.5) / N) * span2;
        const i = Math.round(((s1 - win.p1a) / (win.p1b - win.p1a)) * (n - 1)), j = Math.round(((s2 - win.p2a) / (win.p2b - win.p2a)) * (n - 1));
        const o = (r * N + q) * 4;
        let col: number[] = [238, 240, 243];
        if (i >= 0 && j >= 0 && i < n && j < n) {
          const k = displayIndex(st, i, j), res = k >= 0 ? st.res.get(k) : undefined;
          if (res) col = map.legend.colorOf(res);
        }
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
      const off = new OffscreenCanvas(N, N);
      off.getContext('2d')!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(off, 0, 0, S, S);
    }
    g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(S / 2 - 9, S / 2); g.lineTo(S / 2 + 9, S / 2); g.moveTo(S / 2, S / 2 - 9); g.lineTo(S / 2, S / 2 + 9); g.stroke();
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(S / 2, S / 2, 4.5, 0, 7); g.fill(); g.stroke();
  });

  const drag = useRef(false);
  const at = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const u = v0.a + fx * span1, v = v0.b + (1 - fy) * span2;
    if (zp) setSlice({ ...slice, z: +u.toFixed(5), psi3: +v.toFixed(3) });
    else setPick({ psi1: u, psi2: v });
  };
  const d1 = 10 ** e10, dn = 10 ** (e10 - 2);
  const deg = piece.shape.unit === 'deg';
  const ds = deg ? d1 : dn;
  const sName = deg ? 'ψ₁' : 's';
  const decA = Math.max(3, 1 - e10 + 2), decN = Math.max(4, 3 - e10 + 2);
  const r9 = (v: number) => +v.toFixed(10);
  const row = (name: string, val: number, dec: number, d: number, set: (v: number) => void, unit: string) => (
    <div className="nudge"><span>{name}</span>
      <button onClick={() => set(r9(val - d))}>−</button>
      <NumField value={val} dec={dec} onCommit={set} />
      <button onClick={() => set(r9(val + d))}>+</button>
      <span className="dim small">{unit}</span></div>
  );
  return (
    <div className="finetune">
      <div className="row"><b>Fine-tune</b><span className="dim small">drag on the mini map or nudge; the trajectory updates live</span></div>
      <div className="ft-body">
        <canvas ref={cv} style={{ width: S, height: S, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = true; at(e); }}
          onPointerMove={(e) => { if (drag.current) at(e); }}
          onPointerUp={() => { drag.current = false; }} />
        <div className="ft-ctrl">
          {!map && <div className="dim small">Open the symbolic map once to see the mini map.</div>}
          <div className="seg">
            {[1, 4, 16, 64].map((z) => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>×{z}</button>)}
          </div>
          <div className="seg">
            {(Object.keys(PRESETS) as StepKey[]).map((k) => <button key={k} className={e10 === PRESETS[k] ? 'on' : ''} onClick={() => setE10(PRESETS[k])}>{k}</button>)}
          </div>
          <label className="row small step-sl">step
            <input type="range" min={-6} max={0} step={1} value={e10} onChange={(e) => setE10(+e.target.value)} />
            <span className="dim">{d1.toExponential(0).replace('e+0', '').replace('e-', 'e−')}° / {dn.toExponential(0).replace('e-', 'e−')}</span>
          </label>
          {row(sName, pick.psi1, deg ? decA : decN, ds, (v) => setPick({ ...pick, psi1: v }), deg ? '°' : 'ndim')}
          {row('ψ₂', pick.psi2, decA, d1, (v) => setPick({ ...pick, psi2: v }), '°')}
          {row('z', slice.z, decN, dn, (v) => setSlice({ ...slice, z: v }), 'ndim')}
          {row('ψ₃', slice.psi3, decA, d1, (v) => setSlice({ ...slice, psi3: v }), '°')}
          <div className="dim small">Type a value and press Enter, or use −/+ with the step above (angles in degrees, lengths in Earth–Moon units).</div>
          {map && !zp && <button onClick={() => onZoomMap(span1, span2)}>Recompute the map here</button>}
          {zp && <div className="dim small">Mini map is the (z, ψ₃) map: dragging moves z and ψ₃.</div>}
          {!zp && (slice.z !== 0 || slice.psi3 !== 0) && map && <div className="dim small">z / ψ₃ changes are not in the mini map until it is recomputed.</div>}
        </div>
      </div>
    </div>
  );
}
