import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runMap, displayIndex, workerCount, type MapState, type PointResult, type RunHandle } from '../core/mapEngine';
import { pieceWindow, fmtS, type Window, type Piece } from '../core/boundary';
import { TSTAR_DAYS } from '../core/constants';
import { cacheClear } from '../core/cache';
import { buildLegend, OTHER, type Mode, type Scheme } from './palette';
import { classWord, wordNames as names2 } from '../core/words';
import { Sym } from './widgets';
import { wordNames } from '../core/words';
import { buildModel, ovKey, type PhaseOverride } from '../core/modelSetup';
import { makeDyn, type ModelKind, type ModelParams } from '../core/models';
import { sectionOpts, MAPPING_LABEL, type Slice, type Mapping } from '../core/icmap';
import type { Legend } from './palette';
import type { VoxelPick } from './Volume3D';
const Volume3D = lazy(() => import('./Volume3D').then((m) => ({ default: m.Volume3D })));

export interface Pick { psi1: number; psi2: number }

// default (z, psi3) window: the out-of-plane structure is concentrated near the plane
const ZPSI0: Window = { p1a: -0.03, p1b: 0.03, p2a: -15, p2b: 15 };
// view settings survive leaving and re-opening the map screen
type Axes = 'spsi' | 'zpsi3' | 'vol';
interface VolOpts { stack: 'psi3' | 'z'; a: number; b: number; K: number; other: number; levels: number }
const VOL0: Record<'psi3' | 'z', [number, number]> = { psi3: [-15, 15], z: [-0.03, 0.03] };
const keep = { mode: 'match' as Mode, axes: 'spsi' as Axes, maxClasses: 15, depth: 0, zW: null as Window | null, scheme: 'distinct' as Scheme, lines: true,
  vol: { stack: 'psi3', a: -15, b: 15, K: 13, other: 0, levels: 2 } as VolOpts };
/** layer order: middle first, then outwards, so the picture fills in usefully */
const centreOut = (K: number) => Array.from({ length: K }, (_, q) => q).sort((a, b) => Math.abs(a - (K - 1) / 2) - Math.abs(b - (K - 1) / 2) || a - b);

const RES = {
  quick: { base: 12, levels: 3, label: 'Quick (97 × 97)' },
  standard: { base: 12, levels: 4, label: 'Standard (193 × 193)' },
  fine: { base: 16, levels: 5, label: 'Fine (513 × 513)' },
} as const;
type ResKey = keyof typeof RES;

interface Props {
  C: number;
  user: number[]; // forward word from the section's source region
  userB: number[]; // backward word (reversed); [] = none
  pieces: Piece[];
  pieceIdx: number;
  setPieceIdx: (k: number) => void;
  horizonDays: number;
  setHorizonDays: (d: number) => void;
  coarse: boolean;
  setCoarse: (b: boolean) => void;
  win: Window | null;
  setWin: (w: Window | null) => void;
  onPick: (p: Pick) => void;
  pick: Pick | null;
  modelKind: ModelKind;
  modelName: string;
  jd: number;
  phase: string;
  modelControls?: ReactNode;
  slice: Slice;
  setSlice: (s: Slice) => void;
  onMapState?: (m: { state: MapState; legend: Legend } | null) => void;
  ov?: PhaseOverride | null;
  /** real-mission crossings of this section edge: (s or psi1, psi2) with a label; cur = the one in use */
  marks?: { u: number; v: number; label: string; cur: boolean }[];
}

export function MapScreen({ C, user, userB, pieces, pieceIdx, setPieceIdx, horizonDays, setHorizonDays, coarse, setCoarse, win, setWin, onPick, pick, modelKind, modelName, jd, phase, modelControls, slice, setSlice, onMapState, ov, marks = [] }: Props) {
  const [model, setModel] = useState<{ key: string; params: ModelParams } | null>(null);
  const [modelErr, setModelErr] = useState('');
  useEffect(() => {
    let live = true;
    setModel(null); setModelErr('');
    const key = modelKind === 'cr3bp' ? 'cr3bp' : `${modelKind}@${jd.toFixed(5)}@h${horizonDays}${modelKind !== 'hfem' ? ovKey(ov) : ''}`;
    buildModel(modelKind, jd, horizonDays, ov).then((p) => live && setModel({ key, params: p }), (e) => live && setModelErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [modelKind, jd, horizonDays, ovKey(ov)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dyn = useMemo(() => (model ? makeDyn(model.params) : null), [model]);
  const sopt = useMemo(() => sectionOpts(modelKind, dyn, slice), [dyn, slice, modelKind]);
  const src = user[0], tgt = user[1];
  const piece: Piece | undefined = pieces[Math.min(pieceIdx, pieces.length - 1)];
  const auto = useMemo(() => (piece ? pieceWindow(piece) : null), [piece]);
  const [axes, setAxes] = useState<Axes>(keep.axes);
  const [vol, setVol] = useState<VolOpts>(keep.vol);
  const [layers, setLayers] = useState<(MapState | null)[]>([]);
  const [layerErr, setLayerErr] = useState<Record<number, string>>({});
  const [layerIdx, setLayerIdx] = useState(Math.floor((keep.vol.K - 1) / 2));
  const [mark, setMark] = useState<VoxelPick | null>(null);
  const volVals = useMemo(() => Array.from({ length: vol.K }, (_, k) => +(vol.a + (vol.K > 1 ? ((vol.b - vol.a) * k) / (vol.K - 1) : 0)).toFixed(6)), [vol.a, vol.b, vol.K]);
  const layerSlice = (k: number): Slice => (vol.stack === 'psi3' ? { ...slice, z: vol.other, psi3: volVals[k] } : { ...slice, z: volVals[k], psi3: vol.other });
  const [zW, setZW] = useState<Window>(keep.zW ?? ZPSI0);
  const [fixed, setFixed] = useState<{ s: number; psi2: number } | null>(null);
  // fixed point of the (z, psi3) map: the picked point, else the centre of the (psi1, psi2) window in use
  const cw = win ?? auto;
  const fx = fixed ?? (pick ? { s: pick.psi1, psi2: pick.psi2 } : cw ? { s: +((cw.p1a + cw.p1b) / 2).toFixed(4), psi2: +((cw.p2a + cw.p2b) / 2).toFixed(4) } : { s: 0, psi2: 0 });
  const W = axes === 'zpsi3' ? zW : win ?? auto;
  const setW = (w: Window | null) => (axes === 'zpsi3' ? setZW(w ?? ZPSI0) : setWin(w));
  // zoom history per axis pair, so "previous view" walks back through zoom-ins
  const [hist, setHist] = useState<Record<string, Window[]>>({});
  const hk = axes === 'zpsi3' ? 'z' : 's';
  useEffect(() => { setHist({}); }, [piece?.shape.id, piece?.s0, JSON.stringify(user), C]); // eslint-disable-line react-hooks/exhaustive-deps
  const pushW = (w: Window | null) => {
    if (w && W && JSON.stringify(w) === JSON.stringify(W)) return; // already there (e.g. zoom-out hit the boundary)
    if (W) setHist((h) => ({ ...h, [hk]: [...(h[hk] ?? []), W] }));
    setW(w);
  };
  const backW = () => {
    const h = hist[hk] ?? [];
    if (!h.length) return;
    setW(h[h.length - 1]);
    setHist({ ...hist, [hk]: h.slice(0, -1) });
  };
  const zoomOut = () => {
    if (!W) return;
    const fit = (lo: number, hi: number, A: number, B: number): [number, number] => {
      const sp = hi - lo;
      if (sp >= B - A) return [A, B];
      if (lo < A) return [A, A + sp];
      if (hi > B) return [B - sp, B];
      return [lo, hi];
    };
    const c1 = (W.p1a + W.p1b) / 2, h1 = W.p1b - W.p1a, c2 = (W.p2a + W.p2b) / 2, h2 = W.p2b - W.p2a;
    let a1 = c1 - h1, b1 = c1 + h1, a2 = c2 - h2, b2 = c2 + h2;
    // angles are periodic: compare with the boundary window in the same 360° branch, then shift back
    const fitP = (lo: number, hi: number, A: number, B: number, periodic: boolean): [number, number] => {
      const k = periodic ? Math.round(((lo + hi) / 2 - (A + B) / 2) / 360) : 0;
      const [x, y] = fit(lo - 360 * k, hi - 360 * k, A, B);
      return [x + 360 * k, y + 360 * k];
    };
    if (axes !== 'zpsi3' && auto) {
      [a1, b1] = fitP(a1, b1, auto.p1a, auto.p1b, piece?.shape.unit === 'deg');
      [a2, b2] = fitP(a2, b2, auto.p2a, auto.p2b, true);
    }
    else { [a2, b2] = fit(a2, b2, -90, 90); }
    pushW(winOf(a1, b1, a2, b2));
  };
  const [maxClasses, setMaxClasses] = useState(keep.maxClasses);
  const [depth, setDepth] = useState(keep.depth);
  const [scheme, setScheme] = useState<Scheme>(keep.scheme === 'branch' ? 'distinct' : keep.scheme);
  const [lines, setLines] = useState(keep.lines);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [hover, setHover] = useState('');
  // decimals that keep about 3 significant digits of the window span (fixed rounding stopped zooming at ~0.01 deg)
  const decFor = (span: number) => Math.min(12, Math.max(2, Math.ceil(-Math.log10(Math.max(1e-12, Math.abs(span)))) + 3));
  const MIN_SPAN = 1e-9; // below this the window is too small for double-precision section states to differ
  /** a window from two corners, rounded to the decimals its size needs and never thinner than MIN_SPAN */
  const winOf = (u0: number, u1: number, v0: number, v1: number): Window => {
    const fix = (a: number, b: number): [number, number] => {
      let lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi - lo < MIN_SPAN) { const c = (lo + hi) / 2; lo = c - MIN_SPAN / 2; hi = c + MIN_SPAN / 2; }
      const d = decFor(hi - lo);
      return [+lo.toFixed(d), +hi.toFixed(d)];
    };
    const [p1a, p1b] = fix(u0, u1), [p2a, p2b] = fix(v0, v1);
    return { p1a, p1b, p2a, p2b };
  };
  const [mode, setMode] = useState<Mode>(keep.mode);
  const [res, setRes] = useState<ResKey>('standard');
  const [state0, setState] = useState<MapState | null>(null);
  const state = axes === 'vol' ? layers[Math.min(layerIdx, layers.length - 1)] ?? null : state0;
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const [zoomMode, setZoomMode] = useState(false);
  useEffect(() => { Object.assign(keep, { mode, axes, maxClasses, depth, zW, vol, scheme, lines }); }, [mode, axes, maxClasses, depth, zW, vol, scheme, lines]);
  const run = useRef<RunHandle | null>(null);
  const t0 = useRef(0);

  useEffect(() => {
    if (!W || !model || axes === 'vol') return;
    const id = setTimeout(() => {
      run.current?.cancel();
      t0.current = performance.now();
      if (!piece) return;
      const h = runMap({ C, tEnd: horizonDays / TSTAR_DAYS, user, userB, piece, axes, fixed: fx,
        sopt: axes === 'zpsi3' ? { ...sopt, z: 0, psi3: 0 } : sopt, win: W, base: RES[res].base, levels: RES[res].levels, model: model.params, modelKey: model.key }, (s, m) => {
        setState(s); setMsg(m); setTick((t) => t + 1);
      });
      run.current = h;
      h.promise.then(() => setMsg((m) => `${m} · ${((performance.now() - t0.current) / 1000).toFixed(1)} s`));
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C, horizonDays, JSON.stringify(user), JSON.stringify(userB), JSON.stringify(W), res, model, piece?.shape.id, piece?.sign, piece?.s0, JSON.stringify(sopt), axes, JSON.stringify(axes === 'zpsi3' ? fx : null)]);
  useEffect(() => { setLayerIdx(Math.floor((vol.K - 1) / 2)); }, [vol.K]);
  // 3D volume: one adaptive 2D map per layer (each cached on the device like any map)
  useEffect(() => {
    if (axes !== 'vol' || !W || !model || !piece) return;
    let stop = false;
    const arr: (MapState | null)[] = new Array(vol.K).fill(null);
    setLayers(arr.slice());
    setLayerErr({});
    const id = setTimeout(async () => {
      run.current?.cancel();
      t0.current = performance.now();
      let q = 0;
      for (const k of centreOut(vol.K)) {
        if (stop) return;
        q++;
        const h = runMap({ C, tEnd: horizonDays / TSTAR_DAYS, user, userB, piece, axes: 'spsi', fixed: fx, sopt: sectionOpts(modelKind, dyn, layerSlice(k)), win: W,
          base: 12, levels: vol.levels, model: model.params, modelKey: model.key }, (st, m) => {
          if (stop) return;
          arr[k] = st; setLayers(arr.slice()); setTick((t) => t + 1);
          setMsg(`layer ${q}/${vol.K} (${vol.stack === 'psi3' ? 'ψ₃' : 'z'} = ${volVals[k]}): ${m}`);
        });
        run.current = h;
        try { await h.promise; } catch (e) {
          // one failing layer must not stop the others
          const m = String((e as Error)?.message ?? e);
          console.error('layer', k, m);
          setLayerErr((x) => ({ ...x, [k]: m }));
        }
      }
      if (!stop) setMsg(`done: ${vol.K} layers · ${((performance.now() - t0.current) / 1000).toFixed(1)} s`);
    }, 350);
    return () => { stop = true; clearTimeout(id); run.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes, C, horizonDays, JSON.stringify(user), JSON.stringify(userB), JSON.stringify(W), model, piece?.shape.id, piece?.sign, piece?.s0, JSON.stringify(vol), slice.mapping, dyn]);
  useEffect(() => () => run.current?.cancel(), []);

  // legend + image
  const sts = axes === 'vol' ? (layers.filter(Boolean) as MapState[]) : state ? [state] : [];
  const total = sts.reduce((a, st) => a + st.n1 * st.n2, 0);
  const legend = useMemo(() => {
    if (!sts.length) return null;
    const counts = new Map<PointResult, number>();
    for (const st of sts) {
      const n = st.n1;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = displayIndex(st, i, j);
        if (k < 0) continue;
        const r = st.res.get(k); if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return buildLegend([...counts.keys()], counts, mode, coarse, user, userB, { maxClasses, depth, highlight, scheme });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state0, layers, axes, tick, mode, coarse, maxClasses, depth, highlight, scheme]);
  useEffect(() => { onMapState?.(state && legend ? { state, legend } : null); }, [state, legend, tick, onMapState]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [sideRaw, setSide] = useState(500);
  const [boxW, setBoxW] = useState(500);
  const side = axes === 'vol' ? Math.max(200, Math.min(400, boxW)) : sideRaw;
  useEffect(() => {
    const el = box.current!;
    const fit = () => { setBoxW(el.clientWidth); setSide(Math.max(200, Math.min(el.clientWidth, window.innerHeight - 150))); };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, []);
  // the left margin grows with the decimals the psi2 labels need at deep zoom
  const M = { l: 46 + 7 * Math.max(0, (W ? decFor(W.p2b - W.p2a) - 2 : 1) - 1), r: 8, t: 8, b: 38 };
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !state || !legend) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = side * dpr; cv.height = side * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
    const n = state.n1, img = new ImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = displayIndex(state, i, j);
      const o = ((n - 1 - j) * n + i) * 4;
      const r = k >= 0 ? state.res.get(k) : undefined;
      const c = r ? legend.colorOf(r) : [235, 235, 235];
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    const off = new OffscreenCanvas(n, n);
    off.getContext('2d')!.putImageData(img, 0, 0);
    const pw = side - M.l - M.r, ph = side - M.t - M.b;
    g.imageSmoothingEnabled = false;
    g.drawImage(off, M.l, M.t, pw, ph);
    if (lines) {
      // thin lines wherever the displayed colour changes between neighbouring cells
      const key = new Array<string>(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = displayIndex(state, i, j), r = k >= 0 ? state.res.get(k) : undefined;
        key[j * n + i] = r ? legend.colorOf(r).join() : ''; // by colour, so the classes inside "Other" are not outlined one by one
      }
      const cx = pw / n, cy = ph / n;
      g.beginPath();
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = key[j * n + i];
        if (i + 1 < n && key[j * n + i + 1] !== a) { const x = M.l + (i + 1) * cx, y = M.t + ph - (j + 1) * cy; g.moveTo(x, y); g.lineTo(x, y + cy); }
        if (j + 1 < n && key[(j + 1) * n + i] !== a) { const x = M.l + i * cx, y = M.t + ph - (j + 1) * cy; g.moveTo(x, y); g.lineTo(x + cx, y); }
      }
      g.strokeStyle = 'rgba(17, 24, 39, 0.6)'; g.lineWidth = Math.max(0.6, Math.min(1.2, cx * 0.35)); g.stroke(); g.lineWidth = 1;
    }
    g.strokeStyle = '#333'; g.strokeRect(M.l, M.t, pw, ph);
    // axes
    const w = state.p.win;
    g.fillStyle = '#222'; g.font = '11px system-ui'; g.textAlign = 'center';
    for (let q = 0; q <= 4; q++) {
      const v = w.p1a + (q / 4) * (w.p1b - w.p1a), x = M.l + (q / 4) * pw;
      const dx = Math.max(state.p.axes === 'zpsi3' || piece?.shape.unit !== 'deg' ? 3 : 1, decFor(w.p1b - w.p1a) - 2);
      const dy = Math.max(1, decFor(w.p2b - w.p2a) - 2);
      g.fillText(v.toFixed(dx), x, side - M.b + 14);
      const u = w.p2a + (q / 4) * (w.p2b - w.p2a), y = M.t + ph - (q / 4) * ph;
      g.save(); g.textAlign = 'right'; g.fillText(u.toFixed(dy), M.l - 4, y + 4); g.restore();
    }
    const zp = state.p.axes === 'zpsi3';
    g.fillText(zp ? 'z of the section point [ndim]' : piece?.shape.label ?? 'ψ₁ [deg]', M.l + pw / 2, side - 4);
    g.save(); g.translate(11, M.t + ph / 2); g.rotate(-Math.PI / 2); g.fillText(zp ? 'out-of-plane velocity angle ψ₃ [deg]' : 'ψ₂ [deg]', 0, 0); g.restore();
    const mk = zp ? { u: slice.z, v: slice.psi3 } : axes === 'vol' ? (mark && mark.k === layerIdx ? { u: mark.u, v: mark.v } : null) : pick ? { u: pick.psi1, v: pick.psi2 } : null;
    // real-mission crossings (purple diamonds; periodic angles tried in the window's 360-degree branch)
    if (!zp) for (const m of markPos(w)) {
      const x = M.l + ((m.u - w.p1a) / (w.p1b - w.p1a)) * pw, y = M.t + ph - ((m.v - w.p2a) / (w.p2b - w.p2a)) * ph, r = m.cur ? 8 : 6;
      g.fillStyle = '#9333ea'; g.strokeStyle = '#fff'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke(); g.lineWidth = 1;
    }
    if (mk) {
      const x = M.l + ((mk.u - w.p1a) / (w.p1b - w.p1a)) * pw, y = M.t + ph - ((mk.v - w.p2a) / (w.p2b - w.p2a)) * ph;
      g.fillStyle = '#f59e0b'; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.stroke();
    }
    if (drag.current?.cur) {
      const [a, b] = [drag.current.start, drag.current.cur];
      g.strokeStyle = '#0f172a'; g.setLineDash([4, 3]); g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); g.setLineDash([]);
    }
  });

  const drag = useRef<{ start: { x: number; y: number }; cur?: { x: number; y: number } } | null>(null);
  function markPos(w: Window) {
    const deg = piece?.shape.unit === 'deg', out: { u: number; v: number; label: string; cur: boolean }[] = [];
    for (const m of marks) {
      for (const du of deg ? [0, -360, 360] : [0]) for (const dv of [0, -360, 360]) {
        const u = m.u + du, v = m.v + dv;
        if (u >= w.p1a && u <= w.p1b && v >= w.p2a && v <= w.p2b) out.push({ ...m, u, v });
      }
    }
    return out;
  }
  const toPsi = (x: number, y: number) => {
    const w = state!.p.win, pw = side - M.l - M.r, ph = side - M.t - M.b;
    return { psi1: w.p1a + ((x - M.l) / pw) * (w.p1b - w.p1a), psi2: w.p2a + ((M.t + ph - y) / ph) * (w.p2b - w.p2a) };
  };
  const loc = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  if (!W || !piece) {
    return (
      <div className="empty">
        The boundary between <Sym name={wordNames([src], false)[0]} /> and <Sym name={wordNames([tgt], false)[0]} /> is not accessible at C = {C.toFixed(4)}. Lower C on the word screen.
      </div>
    );
  }
  const set = (k: keyof Window, v: number) => setW({ ...W, [k]: v });
  return (
    <div className={`map-screen ${axes === 'vol' ? 'vol' : ''}`}>
      <div className="map-box" ref={box}>
        {axes === 'vol' && W && (
          <Suspense fallback={<div className="empty">Loading the 3D viewer…</div>}>
            <Volume3D layers={layers} vals={volVals} win={W} legend={legend} tick={tick} layer={layerIdx} setLayer={setLayerIdx}
              labels={{ u: piece.shape.unit === 'deg' ? 'ψ₁' : 's', v: 'ψ₂', w: vol.stack === 'psi3' ? 'ψ₃' : 'z' }} mark={mark} onMark={setMark} />
          </Suspense>
        )}
        {axes === 'vol' && <div className="row small layer-head"><b>Layer {layerIdx + 1}/{vol.K}: {vol.stack === 'psi3' ? `ψ₃ = ${volVals[layerIdx]}°` : `z = ${volVals[layerIdx]}`}</b>
          <input type="range" min={0} max={vol.K - 1} step={1} value={layerIdx} onChange={(e) => setLayerIdx(+e.target.value)} /></div>}
        {axes === 'vol' && <div className="layer-dots" title="layers: filled = done, half = computing, empty = waiting">
          {volVals.map((v, k) => { const L = layers[k]; const st = layerErr[k] ? 'err' : !L ? 'wait' : L.done ? 'done' : 'run'; return <span key={k} className={`ld ${st} ${k === layerIdx ? 'cur' : ''}`} title={`${vol.stack === 'psi3' ? 'ψ₃' : 'z'} = ${v}: ${st}${layerErr[k] ? ' (' + layerErr[k] + ')' : ''}`} onClick={() => setLayerIdx(k)} />; })}
        </div>}
        <canvas ref={canvas} style={{ width: side, height: side, touchAction: 'none', cursor: zoomMode ? 'crosshair' : 'pointer' }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { start: loc(e) }; }}
          onPointerMove={(e) => {
            if (drag.current && zoomMode) { drag.current.cur = loc(e); setTick((t) => t + 1); return; }
            if (!state || !legend) return;
            const p = loc(e), q = toPsi(p.x, p.y), w = state.p.win, n = state.n1;
            const i = Math.round(((q.psi1 - w.p1a) / (w.p1b - w.p1a)) * (n - 1)), j = Math.round(((q.psi2 - w.p2a) / (w.p2b - w.p2a)) * (n - 1));
            if (i < 0 || j < 0 || i >= n || j >= n) { setHover(''); return; }
            const k = displayIndex(state, i, j), r = k >= 0 ? state.res.get(k) : undefined;
            if (!r) { setHover(''); return; }
            const where = W ? `${q.psi1.toFixed(Math.max(3, decFor(W.p1b - W.p1a)))}, ${q.psi2.toFixed(Math.max(2, decFor(W.p2b - W.p2a)))}` : `${q.psi1.toFixed(3)}, ${q.psi2.toFixed(2)}`;
            if (state.p.axes !== 'zpsi3') {
              const pw = side - M.l - M.r, ph = side - M.t - M.b;
              const nearM = markPos(w).find((m) => Math.hypot(M.l + ((m.u - w.p1a) / (w.p1b - w.p1a)) * pw - p.x, M.t + ph - ((m.v - w.p2a) / (w.p2b - w.p2a)) * ph - p.y) < 9);
              if (nearM) { setHover(`◆ ${nearM.label}`); return; }
            }
            if (r.kind !== 'traj') { setHover(`${where}: ${r.kind}`); return; }
            const t = Array.from(r.tokens!);
            const past = r.btokens && r.btokens.length > 1 ? names2(Array.from(r.btokens).reverse(), coarse).slice(0, -1).join(' ') + ' | ' : '';
            setHover(`${where}: ${past}${classWord(t, r.status!, coarse)}`);
          }}
          onPointerLeave={() => setHover('')}
          onPointerUp={(e) => {
            const d = drag.current; drag.current = null;
            if (!d || !state) return;
            const p = loc(e);
            if (zoomMode && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 8) {
              const a = toPsi(d.start.x, d.start.y), b = toPsi(p.x, p.y);
              pushW(winOf(a.psi1, b.psi1, a.psi2, b.psi2));
              setZoomMode(false);
              return;
            }
            const q = toPsi(p.x, p.y), w = state.p.win;
            if (q.psi1 < w.p1a || q.psi1 > w.p1b || q.psi2 < w.p2a || q.psi2 > w.p2b) return;
            if (state.p.axes === 'zpsi3') { setSlice({ ...slice, z: +q.psi1.toFixed(5), psi3: +q.psi2.toFixed(3) }); onPick({ psi1: state.p.fixed.s, psi2: state.p.fixed.psi2 }); }
            else if (axes === 'vol') { setSlice(layerSlice(layerIdx)); onPick({ psi1: q.psi1, psi2: q.psi2 }); }
            else onPick({ psi1: q.psi1, psi2: q.psi2 });
          }} />
        <div className="hover small">{hover || 'Hover over the map to read the word of a cell; tap to open its trajectory.'}</div>
      </div>
      <div className="map-side">
        {modelControls}
        <div className="row model-line"><b>{modelName}</b>{phase && <span className="dim"> · {phase}</span>}</div>
        <div className="row status">
          <span>{modelErr ? `Model data error: ${modelErr}` : !model ? 'loading model data…' : msg || 'starting…'}</span>
          {sts.length > 0 && <span className="dim"> · {sts.reduce((t, st) => t + st.computed, 0)} of {total} points propagated · {workerCount()} threads</span>}
        </div>
        <div className="row">
          <div className="seg">
            <button className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>Your word</button>
            <button className={mode === 'classes' ? 'on' : ''} onClick={() => setMode('classes')}>All classes</button>
          </div>
          <div className="seg">
            <button className={!coarse ? 'on' : ''} onClick={() => setCoarse(false)}>M<sub>T1</sub>/M<sub>B1</sub></button>
            <button className={coarse ? 'on' : ''} onClick={() => setCoarse(true)}>M<sub>1</sub>/M<sub>2</sub></button>
          </div>
        </div>
        <div className="slice-box">
          <div className="row"><b>3D</b>
            <div className="seg">
              <button className={axes === 'spsi' ? 'on' : ''} onClick={() => setAxes('spsi')}>({piece.shape.unit === 'deg' ? 'ψ₁' : 's'}, ψ₂) map</button>
              <button className={axes === 'zpsi3' ? 'on' : ''} onClick={() => { setFixed(fx); setAxes('zpsi3'); }}>(z, ψ₃) map</button>
              <button className={axes === 'vol' ? 'on' : ''} onClick={() => { if (axes !== 'vol') setVol((v) => ({ ...v, other: v.stack === 'psi3' ? slice.z : slice.psi3 })); setAxes('vol'); }}>3D volume</button>
            </div>
          </div>
          {axes === 'vol' ? (
            <>
              <div className="dim small">3D symbolic map over ({piece.shape.unit === 'deg' ? 'ψ₁' : 's'}, ψ₂, {vol.stack === 'psi3' ? 'ψ₃' : 'z'}): a stack of adaptive maps, one per layer, computed middle layer first.</div>
              <div className="row small">
                <span>third axis</span>
                <div className="seg">
                  <button className={vol.stack === 'psi3' ? 'on' : ''} onClick={() => setVol({ ...vol, stack: 'psi3', a: VOL0.psi3[0], b: VOL0.psi3[1], other: slice.z })}>ψ₃ (z fixed)</button>
                  <button className={vol.stack === 'z' ? 'on' : ''} onClick={() => setVol({ ...vol, stack: 'z', a: VOL0.z[0], b: VOL0.z[1], other: slice.psi3 })}>z (ψ₃ fixed)</button>
                </div>
              </div>
              <div className="row win small">
                <span>{vol.stack === 'psi3' ? 'ψ₃' : 'z'} from</span>
                <input type="number" step={vol.stack === 'psi3' ? 1 : 0.005} value={vol.a} onChange={(e) => setVol({ ...vol, a: +e.target.value })} />
                <span>to</span>
                <input type="number" step={vol.stack === 'psi3' ? 1 : 0.005} value={vol.b} onChange={(e) => setVol({ ...vol, b: +e.target.value })} />
                <span>{vol.stack === 'psi3' ? 'z' : 'ψ₃'} =</span>
                <input type="number" step={vol.stack === 'psi3' ? 0.005 : 1} value={vol.other} onChange={(e) => setVol({ ...vol, other: +e.target.value })} />
              </div>
              <div className="row small">
                <select value={vol.K} onChange={(e) => setVol({ ...vol, K: +e.target.value })}>
                  {[7, 13, 25].map((k) => <option key={k} value={k}>{k} layers</option>)}
                </select>
                <select value={vol.levels} onChange={(e) => setVol({ ...vol, levels: +e.target.value })}>
                  <option value={2}>49 × 49 per layer</option>
                  <option value={3}>97 × 97 per layer</option>
                </select>
              </div>
              {mark && (
                <div className="row small">
                  <span>marked: {piece.shape.unit === 'deg' ? 'ψ₁' : 's'} = {mark.u.toFixed(3)}, ψ₂ = {mark.v.toFixed(2)}°, {vol.stack === 'psi3' ? `ψ₃ = ${mark.w}°` : `z = ${mark.w}`}</span>
                  <button onClick={() => { setSlice(layerSlice(mark.k)); onPick({ psi1: mark.u, psi2: mark.v }); }}>Open its trajectory →</button>
                </div>
              )}
            </>
          ) : axes === 'zpsi3' ? (
            <>
              <div className="dim small">Out-of-plane map at a fixed section point: how the word changes with the height z and the out-of-plane velocity angle ψ₃.</div>
              <div className="row win">
                <span>fixed {piece.shape.unit === 'deg' ? 'ψ₁' : 's'}</span>
                <input type="number" step={piece.shape.unit === 'deg' ? 0.1 : 0.001} value={+fx.s.toFixed(4)} onChange={(e) => setFixed({ ...fx, s: +e.target.value })} />
                <span>ψ₂</span>
                <input type="number" step={0.1} value={+fx.psi2.toFixed(3)} onChange={(e) => setFixed({ ...fx, psi2: +e.target.value })} />
                {pick && <button className="link small" onClick={() => setFixed({ s: pick.psi1, psi2: pick.psi2 })}>use the selected point</button>}
              </div>
            </>
          ) : (<>
          <div className="dim small">Slice at fixed z and ψ₃ (the section boundaries are cylinders in z).</div>
          <label className="row slider">
            <span>z = <b>{slice.z.toFixed(3)}</b> <span className="dim">({(slice.z * 384400).toFixed(0)} km)</span></span>
            <input type="range" min={-0.2} max={0.2} step={0.001} value={slice.z} onChange={(e) => setSlice({ ...slice, z: +e.target.value })} />
          </label>
          <label className="row slider">
            <span>ψ₃ = <b>{slice.psi3.toFixed(1)}°</b> <span className="dim">(velocity out of the Earth-Moon plane)</span></span>
            <input type="range" min={-60} max={60} step={0.5} value={slice.psi3} onChange={(e) => setSlice({ ...slice, psi3: +e.target.value })} />
          </label>
          {(slice.z !== 0 || slice.psi3 !== 0) && <button className="link small" onClick={() => setSlice({ ...slice, z: 0, psi3: 0 })}>back to planar</button>}
          </>)}
          <label className="row small">IC mapping
            <select value={slice.mapping} onChange={(e) => setSlice({ ...slice, mapping: e.target.value as Mapping })}>
              {Object.entries(MAPPING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="row slider">
          Horizon <b>{horizonDays.toFixed(0)} d</b> <span className="dim">({(horizonDays / TSTAR_DAYS).toFixed(2)} TU)</span>
          <input type="range" min={5} max={120} step={1} value={horizonDays} onChange={(e) => setHorizonDays(+e.target.value)} />
        </label>
        <div className="row win">
          <span>{axes === 'zpsi3' ? 'z' : piece.shape.unit === 'deg' ? 'ψ₁' : 's'}</span>
          <input type="number" step={axes === 'zpsi3' || piece.shape.unit !== 'deg' ? 0.005 : 0.5} value={W.p1a} onChange={(e) => set('p1a', +e.target.value)} />
          <input type="number" step={axes === 'zpsi3' || piece.shape.unit !== 'deg' ? 0.005 : 0.5} value={W.p1b} onChange={(e) => set('p1b', +e.target.value)} />
          <span>{axes === 'zpsi3' ? 'ψ₃' : 'ψ₂'}</span>
          <input type="number" step={0.5} value={W.p2a} onChange={(e) => set('p2a', +e.target.value)} />
          <input type="number" step={0.5} value={W.p2b} onChange={(e) => set('p2b', +e.target.value)} />
        </div>
        <div className="row">
          <button onClick={() => setZoomMode((z) => !z)} className={zoomMode ? 'on' : ''}>{zoomMode ? 'Drag a box on the map…' : 'Zoom box'}</button>
          <button onClick={zoomOut} title="double the window around its centre">Zoom out ×2</button>
          <button onClick={backW} disabled={!(hist[hk]?.length)} title="go back to the previous window">← Previous view</button>
          <button onClick={() => pushW(null)}>{axes === 'zpsi3' ? 'Default range' : 'Whole boundary'}</button>
          <select value={res} onChange={(e) => setRes(e.target.value as ResKey)}>
            {Object.entries(RES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {pieces.length > 1 && (
          <div className="row dim">
            Boundary pieces at this C:{' '}
            {pieces.map((pc, q) => (
              <button key={q} className={`link ${q === pieceIdx ? 'cur' : ''}`} onClick={() => { setPieceIdx(q); setWin(null); }}>
                {pc.shape.id} {fmtS(pc, pc.s0)}–{fmtS(pc, pc.s1)}
              </button>
            ))}
          </div>
        )}
        <div className="dim small">
          Section: <Sym name={wordNames([src], false)[0]} /> → <Sym name={wordNames([tgt], false)[0]} /> across {piece.shape.label.split(' [')[0].replace(/^\S+ on the /, 'the ').replace(/^distance from Earth along the /, 'the ')}
          {userB.length > 1 ? ' · past symbols are checked by backward propagation over the same horizon' : ''}.
          Tap a point to open its trajectory. Coarse points first, then only where neighbours differ.
        </div>
        {mode === 'classes' && (
          <div className="row small legend-opts">
            <div className="seg" title="Distinct: most different colours; By ending: colour family of the last symbol">
              {([['distinct', 'Distinct'], ['ending', 'By ending']] as [Scheme, string][]).map(([k, t]) => (
                <button key={k} className={scheme === k ? 'on' : ''} onClick={() => setScheme(k)}>{t}</button>
              ))}
            </div>
            <label>colours for
              <select value={maxClasses} onChange={(e) => setMaxClasses(+e.target.value)}>
                {[10, 15, 30, 60, 1000].map((v) => <option key={v} value={v}>{v === 1000 ? 'all' : v} classes</option>)}
              </select>
            </label>
            <label>group by
              <select value={depth} onChange={(e) => setDepth(+e.target.value)}>
                {[0, 3, 4, 5, 6, 8, 10].map((v) => <option key={v} value={v}>{v ? `first ${v} symbols` : 'whole word'}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="row small">
          <label className="switch"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> class boundary lines</label>
        </div>
        <div className="dim small">Click a legend entry to show it alone; click "Other" to open its classes.</div>
        <div className="legend">
          {legend?.entries.map((e) => {
            const plain = /^(partial|match|no |Other|out|forb|\d+ of )/.test(e.label);
            return (
              <div key={e.key} className={`lg ${highlight === e.key ? 'hl' : ''} ${e.sub ? 'sub' : ''}`}
                onClick={() => setHighlight((h) => (h === e.key ? null : e.key === OTHER || !e.sub ? e.key : e.key))}>
                <span className="sw" style={{ background: `rgb(${e.rgb.join(',')})` }} />
                <span className="lt">{plain ? e.label : e.label.split(' ').map((w, q) => (w === '…' ? <span key={q}>…</span> : <Sym key={q} name={w} />))}</span>
                <span className="lc">{((100 * e.count) / Math.max(1, total)).toFixed(e.count / Math.max(1, total) < 0.001 ? 2 : 1)}%</span>
              </div>
            );
          })}
        </div>
        {highlight && <button className="link small" onClick={() => setHighlight(null)}>show all classes again</button>}
        <button className="link small" onClick={() => cacheClear().then(() => setMsg('device cache cleared'))}>Clear device cache</button>
      </div>
    </div>
  );
}
