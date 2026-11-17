import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { propagate, jacobi } from '../core/cr3bp';
import { sectionStateOn, type Piece } from '../core/boundary';
import { TSTAR_DAYS, LSTAR_KM, MU } from '../core/constants';
import { NAMES, COARSE, COLORS, css, textOn } from '../core/symbols';
import { matchLength, wordNames } from '../core/words';
import { RegionView, FULL_VIEW } from './RegionView';
import { Sym } from './widgets';
import type { Pick } from './MapScreen';
import { buildModel, ovKey, type PhaseOverride } from '../core/modelSetup';
import { makeDyn, type ModelKind, type Dyn, type Inertial as InertialPt } from '../core/models';
import { sectionOpts, type Slice } from '../core/icmap';
import { FineTune, type MapView } from './FineTune';
const Traj3D = lazy(() => import('./Traj3D').then((m) => ({ default: m.Traj3D })));

interface Props {
  C: number; pick: Pick; piece: Piece; horizonDays: number; user: number[]; userB: number[]; coarse: boolean;
  modelName: string; modelKind: ModelKind; jd: number; phase: string; modelControls?: ReactNode;
  slice: Slice; setSlice: (s: Slice) => void; setPick: (p: Pick) => void; mapView: MapView | null;
  onZoomMap: (span1: number, span2: number) => void;
  ov?: PhaseOverride | null;
  overlay?: { x: number[]; y: number[] } | null;
}

/** collapse to the displayed alphabet, keeping the entry time and the fine id of each displayed token */
export function display(tokens: number[], times: number[], coarse: boolean) {
  const names: string[] = [], t: number[] = [], ids: number[] = [];
  tokens.forEach((id, q) => {
    const nm = coarse ? COARSE[id] : NAMES[id];
    if (names[names.length - 1] !== nm) { names.push(nm); t.push(times[q]); ids.push(id); }
  });
  return { names, t, ids };
}

const keepFrame = { f: 'rot' as 'rot' | 'side' | 'inertial' | '3d' };

export function TrajScreen({ C, pick, piece, horizonDays, user, userB, coarse, modelName, modelKind, jd, phase, modelControls, slice, setSlice, setPick, mapView, onZoomMap, ov, overlay }: Props) {
  const [dyn, setDyn] = useState<Dyn | null>(null);
  const sopt = useMemo(() => sectionOpts(modelKind, dyn, slice), [modelKind, dyn, slice]);
  const s0 = useMemo(() => sectionStateOn(piece, pick.psi1, pick.psi2, C, sopt), [pick, C, piece, sopt]);
  useEffect(() => {
    let live = true;
    setDyn(null);
    buildModel(modelKind, jd, horizonDays, ov).then((p) => live && setDyn(makeDyn(p)));
    return () => { live = false; };
  }, [modelKind, jd, horizonDays, ovKey(ov)]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasPast = userB.length > 1;
  const [showPast, setShowPast] = useState(hasPast);
  const tEnd = horizonDays / TSTAR_DAYS;
  const r = useMemo(() => (s0 && dyn ? propagate(s0, { tEnd, C, record: true, hMax: 0.01, dyn }) : null), [s0, tEnd, C, dyn]);
  const rb = useMemo(() => (s0 && dyn && showPast ? propagate(s0, { tEnd, C, record: true, hMax: 0.01, dyn, dir: -1 }) : null), [s0, tEnd, C, dyn, showPast]);
  const [frac, setFrac] = useState(1);
  const [frame, setFrameS] = useState<'rot' | 'side' | 'inertial' | '3d'>(keepFrame.f);
  const setFrame = (f: typeof frame) => { keepFrame.f = f; setFrameS(f); };
  const [copied, setCopied] = useState('');
  const fine = <FineTune pick={pick} setPick={setPick} piece={piece} map={mapView} slice={slice} setSlice={setSlice} onZoomMap={onZoomMap} />;
  if (!s0 || !r || (showPast && !rb)) {
    return (
      <div className="traj-screen">
        <div className="traj-view empty">{!s0 ? `This point is forbidden at C = ${C.toFixed(4)} (or points away from the target). Move it with the fine-tune panel.` : `Loading the ${modelName} model…`}</div>
        <div className="traj-side">{modelControls}{fine}</div>
      </div>
    );
  }
  // past (reversed, without the shared start sample) + future
  const nb = rb ? rb.t!.length - 1 : 0;
  const T = [...(rb ? rb.t!.slice(1).reverse() : []), ...r.t!];
  const PP = [...(rb ? rb.P!.slice(1).reverse() : []), ...r.P!];
  const II = [...(rb ? rb.I!.slice(1).reverse() : []), ...r.I!];
  const n = T.length;
  const upto = Math.max(1, Math.round(frac * (n - 1)));
  const lo = 0; // the whole past is always drawn up to the scrubber
  const xs = PP.slice(lo, upto + 1).map((y) => y[0]), ys = PP.slice(lo, upto + 1).map((y) => y[1]);
  const tNow = T[upto];
  const F = display(r.tokens, r.times, coarse);
  const Bd = rb ? display(rb.tokens, rb.times, coarse) : { names: [], t: [], ids: [] };
  const m = matchLength(r.tokens, user, coarse);
  const mb = rb && hasPast ? matchLength(rb.tokens, userB, coarse) : 0;
  const userLen = wordNames(user, coarse).length, userBLen = hasPast ? wordNames(userB, coarse).length : 0;
  const fullF = m >= userLen, fullB = !hasPast || mb >= userBLen;
  // timeline: past tokens (oldest first, without the shared source region) then the future
  const past = Bd.names.slice(1).map((nm, q) => ({ nm, t: Bd.t[q + 1], id: Bd.ids[q + 1], ok: q + 1 < mb })).reverse();
  const fut = F.names.map((nm, q) => ({ nm, t: F.t[q], id: F.ids[q], ok: q < m }));
  const stop = (st: number) => (st === 1 ? 'Moon impact' : st === 2 ? 'Earth impact' : 'horizon');
  const sLabel = piece.shape.unit === 'deg' ? `ψ₁ = ${pick.psi1.toFixed(3)}°` : `s = ${pick.psi1.toFixed(4)}`;
  const icData = () => {
    return {
      model: modelName, epoch_jd_tdb: modelKind === 'cr3bp' ? null : jd, phases: phase || null, C,
      section: { boundary: piece.shape.id, ...(piece.shape.unit === 'deg' ? { psi1_deg: pick.psi1 } : { s_ndim: pick.psi1 }), psi2_deg: pick.psi2, z_ndim: slice.z, psi3_deg: slice.psi3, ic_mapping: slice.mapping },
      notation: 'psi1 = position angle on the boundary (s = coordinate on a straight boundary), psi2 = in-plane velocity angle from +x, psi3 = out-of-plane velocity angle, theta = epoch phase angles',
      section_state_instantaneous: s0, frame_rate_k: dyn?.k, model_initial_state: r.Y0,
      model_state_units: modelKind === 'hfem' ? 'km, km/s, geocentric J2000' : modelKind.startsWith('q') || modelKind === 'hr4bp' ? 'Hill units (LH, 1/n), Sun-EMB rotating frame' : 'pulsating, d/d tau' + (modelKind === 'er3bp' ? ' + true anomaly f' : ''), units: { length_km: LSTAR_KM, time_days_per_TU: TSTAR_DAYS, mu: MU },
      jacobi: jacobi(s0), horizon_days: horizonDays,
      forward: { stop: stop(r.status), end_days: r.tEnd * TSTAR_DAYS, word_fine: r.tokens.map((id) => NAMES[id]), entry_days: r.times.map((t) => t * TSTAR_DAYS) },
      backward: rb ? { stop: stop(rb.status), end_days: rb.tEnd * TSTAR_DAYS, word_fine: rb.tokens.map((id) => NAMES[id]), entry_days: rb.times.map((t) => t * TSTAR_DAYS) } : null,
      user_word_future: user.map((id) => NAMES[id]), user_word_past_reversed: userB.map((id) => NAMES[id]), matched_future: m, matched_past: mb,
    };
  };
  const exportIC = () => {
    const data = icData();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `trajectory_C${C.toFixed(4)}_${piece.shape.id}_${pick.psi1.toFixed(3)}_psi2_${pick.psi2.toFixed(2)}${slice.z || slice.psi3 ? `_z${slice.z}_psi3_${slice.psi3}` : ''}.json`;
    a.click();
  };
  const jump = (t: number) => { const q = T.findIndex((v) => v >= t); setFrac(Math.min(1, Math.max(0, q) / (n - 1))); };
  return (
    <div className="traj-screen">
      <div className="traj-view">
        {<div className="seg overlay">
          <button className={frame === 'rot' ? 'on' : ''} onClick={() => setFrame('rot')}>Rotating</button>
          <button className={frame === 'side' ? 'on' : ''} onClick={() => setFrame('side')}>Side (x–z)</button>
          <button className={frame === 'inertial' ? 'on' : ''} onClick={() => setFrame('inertial')}>Inertial</button>
          <button className={frame === '3d' ? 'on' : ''} onClick={() => setFrame('3d')}>3D</button>
        </div>}
        {frame === 'rot'
          ? <RegionView C={C} overlay={overlay} traj={{ x: xs, y: ys, start: nb }} marker={[xs[xs.length - 1], ys[ys.length - 1]]} initialView={FULL_VIEW} />
          : frame === '3d'
            ? <Suspense fallback={<div className="empty">Loading the 3D viewer…</div>}><Traj3D P={PP} I={II} start={nb} upto={upto} C={C} piece={piece} zSec={slice.z} /></Suspense>
            : frame === 'side'
            ? <SideView P={PP.slice(0, upto + 1)} start={nb} />
            : <Inertial P={II.slice(0, upto + 1)} />}
      </div>
      <div className="traj-side">
        {modelControls}
        {fine}
        <div className="row">
          <b>{sLabel}, ψ₂ = {pick.psi2.toFixed(3)}°{(slice.z !== 0 || slice.psi3 !== 0) && `, z = ${slice.z.toFixed(4)}, ψ₃ = ${slice.psi3.toFixed(2)}°`}</b> · C = {C.toFixed(4)} · {modelName}{phase && <span className="dim"> · {phase}</span>}
        </div>
        <label className="row slider">
          Time <b>{(tNow * TSTAR_DAYS).toFixed(2)} d</b>
          <span className="dim">
            {rb ? `past to ${(rb.tEnd * TSTAR_DAYS).toFixed(1)} d (${stop(rb.status)}), ` : ''}future to {(r.tEnd * TSTAR_DAYS).toFixed(1)} d ({stop(r.status)})
          </span>
          <input type="range" min={0} max={1000} value={Math.round(frac * 1000)} onChange={(e) => setFrac(+e.target.value / 1000)} />
        </label>
        <div className="row">
          {fullF && fullB
            ? <span className="ok">Realises your word ({userBLen ? userBLen - 1 + userLen : userLen} symbols)</span>
            : <span className="warn">Future: {m} of {userLen} symbols{hasPast ? ` · past: ${Math.max(0, mb - 1)} of ${userBLen - 1}` : ''}</span>}
          {!hasPast && <label className="switch small"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> show the past too</label>}
        </div>
        <div className="timeline">
          {past.map((e, q) => (
            <div key={'b' + q} className={`tl ${e.ok && hasPast ? 'matched' : ''}`} onClick={() => jump(e.t)}>
              <span className="chip" style={{ background: css(COLORS[e.id]), color: textOn(COLORS[e.id]) }}><Sym name={e.nm} /></span>
              <span className="dim">{(e.t * TSTAR_DAYS).toFixed(2)} d</span>
            </div>
          ))}
          {past.length > 0 && <div className="tl now">now</div>}
          {fut.map((e, q) => (
            <div key={q} className={`tl ${e.t <= tNow ? '' : 'future'} ${e.ok ? 'matched' : ''}`} onClick={() => jump(e.t)}>
              <span className="chip" style={{ background: css(COLORS[e.id]), color: textOn(COLORS[e.id]) }}><Sym name={e.nm} /></span>
              <span className="dim">{(e.t * TSTAR_DAYS).toFixed(2)} d</span>
            </div>
          ))}
          {(r.status === 1 || r.status === 2) && <div className="tl"><span className="dim">impact ★</span></div>}
        </div>
        <div className="row">
          <button onClick={exportIC}>Download initial state (JSON)</button>
          <button onClick={() => {
            const txt = JSON.stringify(icData(), null, 2);
            navigator.clipboard?.writeText(txt).then(() => setCopied('Copied'), () => setCopied('Copy blocked: select the text below'));
          }}>Copy JSON</button>
          {copied && <span className="dim small">{copied}</span>}
        </div>
        <details><summary className="small">Show JSON</summary><textarea readOnly className="json" value={JSON.stringify(icData(), null, 2)} /></details>
        <div className="dim small">Section state (instantaneous units): [{s0.map((v) => v.toFixed(9)).join(', ')}]</div>
      </div>
    </div>
  );
}

export function Inertial({ P, breaks = [] }: { P: InertialPt[]; breaks?: number[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState(400);
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSz(Math.max(200, Math.min(el.clientWidth, el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current!; const dpr = window.devicePixelRatio || 1;
    c.width = sz * dpr; c.height = sz * dpr;
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, sz, sz);
    // Earth-centred, epoch Earth-Moon plane, Moon on +x at t = 0, unit 384 400 km
    const R = Math.max(1.25, ...P.map((q) => Math.hypot(q.sc[0], q.sc[1])), ...P.map((q) => Math.hypot(q.moon[0], q.moon[1]))) * 1.12;
    const X = (x: number) => sz / 2 + (x / R) * (sz / 2), Yp = (y: number) => sz / 2 - (y / R) * (sz / 2);
    // Moon path so far (dashed) and Earth
    g.strokeStyle = '#9aa3b2'; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath();
    P.forEach((q, i) => (i ? g.lineTo(X(q.moon[0]), Yp(q.moon[1])) : g.moveTo(X(q.moon[0]), Yp(q.moon[1])))); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#5a0000'; g.beginPath(); g.arc(X(0), Yp(0), 5, 0, 7); g.fill();
    // spacecraft
    g.strokeStyle = '#000'; g.lineWidth = 1.4; g.beginPath();
    P.forEach((q, i) => (i ? g.lineTo(X(q.sc[0]), Yp(q.sc[1])) : g.moveTo(X(q.sc[0]), Yp(q.sc[1])))); g.stroke();
    const e = P[P.length - 1];
    g.fillStyle = '#8c8c8c'; g.strokeStyle = '#333'; g.beginPath(); g.arc(X(e.moon[0]), Yp(e.moon[1]), 4.5, 0, 7); g.fill(); g.stroke();
    breaks.filter((b) => b - 1 < P.length).forEach((b) => { const q = P[b - 1]; g.fillStyle = '#dc2626'; g.beginPath(); g.moveTo(X(q.sc[0]), Yp(q.sc[1]) - 7); g.lineTo(X(q.sc[0]) + 6, Yp(q.sc[1]) + 4.5); g.lineTo(X(q.sc[0]) - 6, Yp(q.sc[1]) + 4.5); g.fill(); });
    g.fillStyle = '#f59e0b'; g.strokeStyle = '#000'; g.beginPath(); g.arc(X(e.sc[0]), Yp(e.sc[1]), 5, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#333'; g.font = '12px system-ui';
    g.fillText('Inertial, Earth-centred (Moon at +x at the start)', 8, 16);
    g.fillText('unit: 384 400 km', 8, 32);
    // Sun direction arrow at the border
    if (e.sun) {
      const hl = Math.hypot(e.sun[0], e.sun[1]) || 1, ux = e.sun[0] / hl, uy = e.sun[1] / hl, r0 = sz / 2 - 22, r1 = sz / 2 - 58;
      const ax = sz / 2 + ux * r0, ay = sz / 2 - uy * r0, bx = sz / 2 + ux * r1, by = sz / 2 - uy * r1;
      g.strokeStyle = '#d97706'; g.fillStyle = '#d97706'; g.lineWidth = 3; g.beginPath(); g.moveTo(bx, by); g.lineTo(ax, ay); g.stroke();
      const an = Math.atan2(ay - by, ax - bx);
      g.beginPath(); g.moveTo(ax + 4 * Math.cos(an), ay + 4 * Math.sin(an));
      g.lineTo(ax - 10 * Math.cos(an - 0.45), ay - 10 * Math.sin(an - 0.45)); g.lineTo(ax - 10 * Math.cos(an + 0.45), ay - 10 * Math.sin(an + 0.45)); g.fill();
      g.font = '600 12px system-ui'; g.textAlign = 'center'; g.fillText('Sun', bx - 14 * ux, by + 14 * uy + 4); g.textAlign = 'left';
    } else {
      g.fillText('no Sun in this model', 8, sz - 10);
    }
  }, [P, sz, breaks]);
  return <div className="inertial" ref={wrap}><canvas ref={cv} style={{ width: sz, height: sz }} /></div>;
}

/** side view of the pulsating frame: x (horizontal) vs z, with the Moon and L1/L2 */
export function SideView({ P, start }: { P: number[][]; start: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 500, h: 400 });
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSz({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current!, dpr = window.devicePixelRatio || 1;
    c.width = sz.w * dpr; c.height = sz.h * dpr;
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, sz.w, sz.h);
    const xs = P.map((p) => p[0]), zs = P.map((p) => p[2] ?? 0);
    const x0 = Math.min(0.6, ...xs), x1 = Math.max(1.4, ...xs);
    const zm = Math.max(0.05, ...zs.map(Math.abs)) * 1.15;
    const sx = (sz.w - 40) / (x1 - x0), sc = Math.min(sx, (sz.h - 40) / (2 * zm));
    const X = (x: number) => 30 + (x - x0) * sc, Z = (z: number) => sz.h / 2 - z * sc;
    g.strokeStyle = '#d1d5db'; g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(sz.w, Z(0)); g.stroke();
    for (const [x, col, nm] of [[0.8369, '#e11d48', 'L1'], [1.1557, '#d946ef', 'L2']] as [number, string, string][]) {
      g.strokeStyle = col; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), sz.h); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.font = '11px system-ui'; g.fillText(nm, X(x) + 3, 14);
    }
    const k0 = Math.min(start, P.length - 1);
    const seg = (a: number, b: number) => { g.beginPath(); for (let q = a; q <= b; q++) q === a ? g.moveTo(X(xs[q]), Z(zs[q])) : g.lineTo(X(xs[q]), Z(zs[q])); g.stroke(); };
    if (k0 > 0) { g.strokeStyle = '#6b7280'; g.setLineDash([5, 3]); seg(0, k0); g.setLineDash([]); }
    g.strokeStyle = '#000'; g.lineWidth = 1.5; seg(k0, P.length - 1);
    g.fillStyle = '#8c8c8c'; g.strokeStyle = '#333'; g.lineWidth = 1; g.beginPath(); g.arc(X(1 - 0.01215), Z(0), Math.max(4, 0.0045 * sc), 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#333'; g.font = '11px system-ui'; g.fillText('Moon', X(1 - 0.01215) - 14, Z(0) + 18);
    g.fillStyle = '#f59e0b'; g.strokeStyle = '#000'; g.beginPath(); g.arc(X(xs.at(-1)!), Z(zs.at(-1)!), 5, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#333'; g.font = '12px system-ui'; g.fillText('Side view, pulsating frame: x (right) and z (up), equal scale', 8, sz.h - 10);
  }, [P, sz, start]);
  return <div className="inertial" ref={wrap}><canvas ref={cv} style={{ width: sz.w, height: sz.h }} /></div>;
}
