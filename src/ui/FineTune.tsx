import { useEffect, useRef, useState } from 'react';
import type { Piece, Window } from '../core/boundary';
import type { Slice } from '../core/icmap';
import { displayIndex, runMap, type MapState, type RunHandle } from '../core/mapEngine';
import type { Legend } from './palette';
import type { Pick } from './MapScreen';

export interface MapView { state: MapState; legend: Legend }

// step = 10^e deg for angles and 10^(e-2) for lengths [ndim], e = 0 .. -10. Finer steps are not meaningful:
// the integrator's relative tolerance is 1e-10, and at psi1 ~ 190 deg a double resolves only ~3e-14 deg.
const E_MIN = -10;
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

  // the mini map is recomputed around the point whenever the point, the zoom or the slice changes
  const [mini, setMini] = useState<{ state: MapState; win: Window } | null>(null);
  const [miniMsg, setMiniMsg] = useState('');
  const run = useRef<RunHandle | null>(null);
  const P = map?.state.p;
  useEffect(() => {
    if (!P) return;
    const w: Window = { p1a: v0.a, p1b: v0.a + span1, p2a: v0.b, p2b: v0.b + span2 };
    setMiniMsg('');
    const id = setTimeout(() => {
      run.current?.cancel();
      const h = runMap({
        ...P, win: w, base: 8, levels: 2, noCache: true,
        ...(zp ? { fixed: { s: pick.psi1, psi2: pick.psi2 } } : { sopt: { ...P.sopt, z: slice.z, psi3: slice.psi3 } }),
      }, (st, m) => { setMini({ state: st, win: w }); setMiniMsg(m); });
      run.current = h;
      h.promise.then(() => setMiniMsg('done'), () => {});
    }, 350);
    return () => { clearTimeout(id); run.current?.cancel(); };
  }, [P, zoom, ctr.a, ctr.b, span1, span2, slice.z, slice.psi3, pick.psi1, pick.psi2]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = S * dpr; c.height = S * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#eef0f3'; g.fillRect(0, 0, S, S);
    if (map && win) {
      const N = 110, img = new ImageData(N, N);
      // the mini map's own computed state first (it follows zoom and moves), the main map as a fallback
      const sample = (st: MapState, w: Window, s1: number, s2: number) => {
        const n = st.n1;
        const i = Math.round(((s1 - w.p1a) / (w.p1b - w.p1a)) * (n - 1)), j = Math.round(((s2 - w.p2a) / (w.p2b - w.p2a)) * (n - 1));
        if (i < 0 || j < 0 || i >= n || j >= n) return undefined;
        const k = displayIndex(st, i, j);
        return k >= 0 ? st.res.get(k) : undefined;
      };
      for (let q = 0; q < N; q++) for (let r = 0; r < N; r++) {
        const s1 = v0.a + ((q + 0.5) / N) * span1, s2 = v0.b + ((N - r - 0.5) / N) * span2;
        const o = (r * N + q) * 4;
        let col: number[] = [238, 240, 243];
        const res = (mini && sample(mini.state, mini.win, s1, s2)) || sample(map.state, win, s1, s2);
        if (res) col = map.legend.colorOf(res);
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
  // round a nudged value to a few digits below the step (a fixed 10 digits used to swallow steps below 1e-10)
  const rs = (v: number, d: number) => +v.toFixed(Math.min(16, Math.max(0, Math.ceil(-Math.log10(d)) + 3)));
  const row = (name: string, val: number, dec: number, d: number, set: (v: number) => void, unit: string) => (
    <div className="nudge"><span>{name}</span>
      <button onClick={() => set(rs(val - d, d))}>−</button>
      <NumField value={val} dec={dec} onCommit={set} />
      <button onClick={() => set(rs(val + d, d))}>+</button>
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
            {[1, 4, 16, 64, 256, 1024].map((z) => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>×{z}</button>)}
          </div>
          <label className="row small step-sl">step
            <input type="range" min={E_MIN} max={0} step={1} value={e10} onChange={(e) => setE10(+e.target.value)}
              title="finest: 1e−10° for angles, 1e−12 for lengths (the integrator tolerance; smaller changes are numerical noise)" />
            <span className="dim">{d1.toExponential(0).replace('e+0', '').replace('e-', 'e−')}° / {dn.toExponential(0).replace('e-', 'e−')}</span>
          </label>
          {row(sName, pick.psi1, deg ? decA : decN, ds, (v) => setPick({ ...pick, psi1: v }), deg ? '°' : 'ndim')}
          {row('ψ₂', pick.psi2, decA, d1, (v) => setPick({ ...pick, psi2: v }), '°')}
          {row('z', slice.z, decN, dn, (v) => setSlice({ ...slice, z: v }), 'ndim')}
          {row('ψ₃', slice.psi3, decA, d1, (v) => setSlice({ ...slice, psi3: v }), '°')}
          <div className="dim small">Type a value and press Enter, or use −/+ with the step above (angles in degrees, lengths in Earth–Moon units).</div>
          {map && !zp && <button onClick={() => onZoomMap(span1, span2)}>Recompute the map here</button>}
          {zp && <div className="dim small">Mini map is the (z, ψ₃) map: dragging moves z and ψ₃.</div>}
          {map && <div className="dim small">Mini map recomputed around the point ({miniMsg === 'done' ? 'up to date' : miniMsg ? 'computing…' : 'waiting'}); ×1–×1024 zooms it.</div>}
        </div>
      </div>
    </div>
  );
}
