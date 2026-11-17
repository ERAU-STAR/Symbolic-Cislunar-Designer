// Screen 4: impulsive maneuvers on the chosen trajectory. Every change re-propagates
// the whole plan at once (one trajectory, a few ms to ~100 ms depending on the model).
// Forward design: a burn changes the trajectory after it. Backward design: the trajectory
// after the burn is kept and the one before it changes (the state before = after - dv).
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sectionStateOn, type Piece } from '../core/boundary';
import { TSTAR_DAYS, LSTAR_KM, MU } from '../core/constants';
import { COLORS, css, textOn } from '../core/symbols';
import { matchLength, wordNames } from '../core/words';
import { buildModel, ovKey, type PhaseOverride } from '../core/modelSetup';
import { makeDyn, type ModelKind, type Dyn, type ModelParams } from '../core/models';
import { sectionOpts, type Slice } from '../core/icmap';
import { runPlanAnchored, runPlanBackward, FRAME_LABEL, COMP_LABEL, ALPHA_HINT, BETA_HINT, dvOf, type Burn, type DvFrame, type PlanResult } from '../core/maneuver';
import { DvMap } from './DvMap';
import { RegionView, FULL_VIEW } from './RegionView';
import { Sym } from './widgets';
import { display, Inertial } from './TrajScreen';
import type { Pick } from './MapScreen';
const Traj3D = lazy(() => import('./Traj3D').then((m) => ({ default: m.Traj3D })));

interface Props {
  C: number; pick: Pick; piece: Piece; horizonDays: number; setHorizonDays: (d: number) => void;
  user: number[]; userB: number[]; coarse: boolean;
  modelName: string; modelKind: ModelKind; jd: number; phase: string; modelControls?: ReactNode;
  slice: Slice; burns: Burn[]; setBurns: (b: Burn[]) => void; ov?: PhaseOverride | null;
  overlay?: { x: number[]; y: number[] } | null;
  /** open the dv map at this burn (from the mission panel) */
  focus?: { id: number; nonce: number } | null;
}

const SEG_COL = ['#000000', '#1d4ed8', '#c2410c', '#15803d', '#7e22ce', '#be123c', '#0e7490'];
const keep = { frame: 'rot' as 'rot' | 'inertial' | '3d', e: 0, sel: 0, back: false, showMap: true, follow: true };

function NumField({ value, dec, onCommit, w = 96 }: { value: number; dec: number; onCommit: (v: number) => void; w?: number }) {
  const [txt, setTxt] = useState(value.toFixed(dec));
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (!edit) setTxt(value.toFixed(dec)); }, [value, dec, edit]);
  const commit = () => { setEdit(false); const v = parseFloat(txt); if (Number.isFinite(v) && v !== value) onCommit(v); else setTxt(value.toFixed(dec)); };
  return <input className="numf" style={{ width: w }} type="text" inputMode="decimal" value={txt} onFocus={() => setEdit(true)} onChange={(e) => setTxt(e.target.value)}
    onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(value.toFixed(dec)); setEdit(false); } }} />;
}

export function ManeuverScreen({ C, pick, piece, horizonDays, setHorizonDays, user, userB, coarse, modelName, modelKind, jd, phase, modelControls, slice, burns, setBurns, ov, overlay, focus }: Props) {
  const [dyn, setDyn] = useState<Dyn | null>(null);
  const [params, setParams] = useState<ModelParams | null>(null);
  useEffect(() => {
    let live = true;
    setDyn(null);
    buildModel(modelKind, jd, horizonDays, ov).then((p) => { if (live) { setParams(p); setDyn(makeDyn(p)); } });
    return () => { live = false; };
  }, [modelKind, jd, horizonDays, ovKey(ov)]); // eslint-disable-line react-hooks/exhaustive-deps
  const modelKey = modelKind === 'cr3bp' ? 'cr3bp' : `${modelKind}@${jd.toFixed(5)}@h${horizonDays}${modelKind !== 'hfem' ? ovKey(ov) : ''}`;
  const sopt = useMemo(() => sectionOpts(modelKind, dyn, slice), [modelKind, dyn, slice]);
  const s0 = useMemo(() => sectionStateOn(piece, pick.psi1, pick.psi2, C, sopt), [pick, C, piece, sopt]);
  const [frame, setFrameS] = useState(keep.frame);
  const setFrame = (f: typeof frame) => { keep.frame = f; setFrameS(f); };
  const [e10, setE10S] = useState(keep.e); // nudge size: 10^e m/s and 10^e deg
  const setE10 = (e: number) => { keep.e = e; setE10S(e); };
  const [sel, setSelS] = useState(keep.sel);
  const setSel = (id: number) => { keep.sel = id; setSelS(id); };
  const [back, setBackS] = useState(keep.back);
  const setBack = (b: boolean) => { keep.back = b; setBackS(b); };
  const [showMap, setShowMapS] = useState(keep.showMap);
  const setShowMap = (b: boolean) => { keep.showMap = b; setShowMapS(b); };
  const [follow, setFollowS] = useState(keep.follow);
  const setFollow = (b: boolean) => { keep.follow = b; setFollowS(b); };
  const [frac, setFrac] = useState(back ? 0.5 : 1);
  const [showGhost, setShowGhost] = useState(true);
  const [copied, setCopied] = useState('');
  void userB;

  const t0 = performance.now();
  const plan = useMemo<PlanResult & { now?: number } | null>(() => (s0 && dyn ? (back ? runPlanBackward(dyn, s0, C, horizonDays, burns) : runPlanAnchored(dyn, s0, C, horizonDays, burns)) : null), [s0, dyn, C, horizonDays, burns, back]);
  const ms = performance.now() - t0;
  const ghost = useMemo<PlanResult & { now?: number } | null>(() => (s0 && dyn ? (back ? runPlanBackward(dyn, s0, C, horizonDays, []) : runPlanAnchored(dyn, s0, C, horizonDays, [])) : null), [s0, dyn, C, horizonDays, back]);

  // focus a burn: select it, stop following the time slider, show its dv map, move the time slider there
  const focused = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === focused.current || !plan) return;
    const b = burns.find((x) => x.id === focus.id);
    if (!b) return;
    setSel(b.id); setFollow(false); setShowMap(true);
    focused.current = focus.nonce;
    const T0 = plan.t;
    const tau = b.tDays / TSTAR_DAYS, q = T0.findIndex((t) => t >= tau);
    if (q >= 0) setFrac(q / Math.max(1, T0.length - 1));
  }, [focus?.nonce, plan, back]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s0 || !plan || !ghost || !dyn || !params) {
    return (
      <div className="traj-screen">
        <div className="traj-view empty">{!s0 ? `This point is forbidden at C = ${C.toFixed(4)}.` : `Loading the ${modelName} model…`}</div>
        <div className="traj-side">{modelControls}</div>
      </div>
    );
  }
  // samples in time order; nb = index of the section time t = 0
  let T: number[], PP: number[][], II: NonNullable<PlanResult['I']>, nb: number, breaks: number[];
  T = plan.t; PP = plan.P; II = plan.I!; nb = plan.now!; breaks = plan.breaks; void nb;
  const n = T.length;
  const upto = Math.max(1, Math.round(frac * (n - 1)));
  const tNow = T[upto], tNowD = tNow * TSTAR_DAYS;
  const xs = PP.slice(0, upto + 1).map((p) => p[0]), ys = PP.slice(0, upto + 1).map((p) => p[1]);
  const G = display(ghost.tokens, ghost.times, coarse), F = display(plan.tokens, plan.times, coarse);
  // which symbols changed: forward = common prefix kept; backward = common suffix kept
  const k0F = Math.max(0, F.t.reduce((a, t, q) => (t <= 0 ? q : a), 0)), k0G = Math.max(0, G.t.reduce((a, t, q) => (t <= 0 ? q : a), 0));
  let divF = 0, divP = 0; // future symbols kept after "now", past symbols kept before it
  while (k0F + divF < F.names.length && k0G + divF < G.names.length && F.names[k0F + divF] === G.names[k0G + divF]) divF++;
  while (k0F - 1 - divP >= 0 && k0G - 1 - divP >= 0 && F.names[k0F - 1 - divP] === G.names[k0G - 1 - divP]) divP++;
  let divS = 0; while (divS < F.names.length && divS < G.names.length && F.names[F.names.length - 1 - divS] === G.names[G.names.length - 1 - divS]) divS++;
  const changed = (q: number) => burns.some((b) => b.on) && (back ? q < F.names.length - divS : q >= k0F + divF || q < k0F - divP);
  const sameWord = F.names.length === G.names.length && F.names.every((nm, q) => nm === G.names[q]);
  // user-word match: forward part from the section (backward design: from the symbol at t = 0)
  const userLen = wordNames(user, coarse).length;
  let k0 = 0; for (let q = 0; q < plan.times.length; q++) if (plan.times[q] <= 0) k0 = q;
  const m = matchLength(plan.tokens.slice(k0), user, coarse);
  const stop = (st: number) => (st === 1 ? 'Moon impact' : st === 2 ? 'Earth impact' : 'horizon');
  const tMin = -horizonDays + 0.01, tMax = horizonDays - 0.01;
  const okTime = (t: number) => t > tMin && t < tMax && Math.abs(t) > 1e-4;

  const nextId = () => Math.max(0, ...burns.map((b) => b.id)) + 1;
  const addBurn = (tDays: number, v?: { mag: number; alpha: number; beta: number }) => {
    const id = nextId();
    setBurns([...burns, { id, tDays: +Math.min(tMax, Math.max(tMin, tDays)).toFixed(4), frame: 'vnb-moon', mag: v?.mag ?? 0, alpha: v?.alpha ?? 0, beta: v?.beta ?? 0, on: true }]);
    setSel(id);
  };
  const upd = (id: number, f: (b: Burn) => Burn) => setBurns(burns.map((b) => (b.id === id ? f(b) : b)));
  const step = 10 ** e10, astep = 10 ** Math.min(1, e10);
  const selBurn = burns.find((b) => b.id === sel) ?? null;
  const r6 = (v: number) => +v.toFixed(6);
  const order = [...burns].sort((a, b) => a.tDays - b.tDays);
  const label = (b: Burn) => `Δv${order.indexOf(b) + 1}`;
  // the dv map is for a burn at the time slider (follow) or at the selected burn
  const mapT = follow || !selBurn ? +tNowD.toFixed(3) : selBurn.tDays;
  const mapFrame: DvFrame = selBurn?.frame ?? 'vnb-moon';
  const onMapSet = (mag: number, alpha: number, beta: number) => {
    if (selBurn) upd(selBurn.id, (x) => ({ ...x, mag, alpha, beta, ...(follow ? { tDays: mapT } : {}) }));
    else addBurn(mapT, { mag, alpha, beta });
  };

  const exportData = () => ({
    model: modelName, epoch_jd_tdb: modelKind === 'cr3bp' ? null : jd, phases: phase || null, C_section: C, design: back ? 'backward (trajectory after the last burn kept)' : 'forward',
    section: { boundary: piece.shape.id, ...(piece.shape.unit === 'deg' ? { psi1_deg: pick.psi1 } : { s_ndim: pick.psi1 }), psi2_deg: pick.psi2, z_ndim: slice.z, psi3_deg: slice.psi3, ic_mapping: slice.mapping },
    section_state: s0, units: { length_km: LSTAR_KM, time_days_per_TU: TSTAR_DAYS, mu: MU }, horizon_days: horizonDays,
    burns: plan.burns.map((r) => ({
      label: label(r.burn), on: r.burn.on, reached: r.reached, t_days: r.burn.tDays, frame: r.burn.frame, dv_mag_ms: r.dvMag, alpha_deg: r.burn.alpha, beta_deg: r.burn.beta,
      dv_components_ms: { [COMP_LABEL[r.burn.frame].join('')]: dvOf(r.burn) },
      dv_rotating_xyz_ms: r.dvRot ?? null, dv_inertial_kms: r.dvInertial ?? null, C_before: r.CBefore ?? null, C_after: r.CAfter ?? null,
      model_state_before: r.yBefore ?? null, model_state_after: r.yAfter ?? null,
    })),
    total_dv_ms: plan.totalDv, end: { stop: stop(plan.status), days: plan.tEnd * TSTAR_DAYS },
    word_without_burns: G.names, word_with_burns: F.names, entry_days: F.t.map((t) => t * TSTAR_DAYS),
  });
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }));
    a.download = `maneuvers_${modelKind}_C${C.toFixed(4)}_${burns.length}burns${back ? '_backward' : ''}.json`;
    a.click();
  };
  const jump = (t: number) => { const q = T.findIndex((v) => v >= t); setFrac(Math.min(1, Math.max(0, q) / (n - 1))); };

  // timeline: words with burn markers (and "now" in the backward design) in time order
  type TL = { k: 'tok'; nm: string; id: number; t: number; q: number } | { k: 'burn'; b: Burn; t: number } | { k: 'now'; t: number };
  const timeline: TL[] = [
    ...F.names.map((nm, q) => ({ k: 'tok' as const, nm, id: F.ids[q], t: F.t[q], q })),
    ...plan.burns.filter((r) => r.reached).map((r) => ({ k: 'burn' as const, b: r.burn, t: r.tau })),
    { k: 'now' as const, t: 0 },
  ].sort((a, b) => a.t - b.t || (a.k === 'tok' ? 1 : -1));

  const trajView = frame === 'rot'
    ? <RegionView C={C} overlay={overlay} traj={{ x: xs, y: ys, start: 0, breaks, ghost: showGhost && burns.some((b) => b.on) ? { x: ghost.P.map((p) => p[0]), y: ghost.P.map((p) => p[1]) } : undefined }}
        marker={[xs[xs.length - 1], ys[ys.length - 1]]} initialView={FULL_VIEW} />
    : frame === 'inertial'
      ? <Inertial P={II.slice(0, upto + 1)} breaks={breaks} />
      : <Suspense fallback={<div className="empty">Loading the 3D viewer…</div>}><Traj3D P={PP} I={II} start={0} upto={upto} C={C} piece={piece} zSec={slice.z} breaks={breaks} /></Suspense>;

  return (
    <div className="traj-screen man-screen">
      <div className={`man-views ${showMap ? 'with-map' : ''}`}>
        <div className="traj-view">
          <div className="seg overlay">
            <button className={frame === 'rot' ? 'on' : ''} onClick={() => setFrame('rot')}>Rotating</button>
            <button className={frame === 'inertial' ? 'on' : ''} onClick={() => setFrame('inertial')}>Inertial</button>
            <button className={frame === '3d' ? 'on' : ''} onClick={() => setFrame('3d')}>3D</button>
          </div>
          {trajView}
        </div>
        {showMap && (
          <div className="man-map">
            <DvMap dyn={dyn} params={params} modelKey={modelKey} s0={s0} C={C} horizonDays={horizonDays}
              burns={back ? burns : mapT < 0 ? burns.filter((b) => b.tDays < 0) : burns} skipId={selBurn?.id ?? null}
              tDays={mapT} frame={mapFrame} backward={back || mapT < 0} current={selBurn && Math.abs(selBurn.tDays - mapT) < 1e-3 ? selBurn : null}
              piece={piece} user={user} coarse={coarse} onSet={onMapSet}
              focus={focus && selBurn && selBurn.id === focus.id ? { nonce: focus.nonce, mag: selBurn.mag, beta: selBurn.beta } : null} />
          </div>
        )}
      </div>
      <div className="traj-side">
        {modelControls}
        <div className="man-head">
          <b>Maneuvers</b>
          <span className="dim small">{modelName} · C = {C.toFixed(4)} at the section · {ms < 1 ? '<1' : ms.toFixed(0)} ms per update</span>
        </div>
        <div className="row small">
          <span>A burn changes</span>
          <div className="seg">
            <button className={!back ? 'on' : ''} onClick={() => { setBack(false); setFrac(1); }} title="the state at the section is kept: a burn after it changes the future, a burn before it changes the past">the side away from the section</button>
            <button className={back ? 'on' : ''} onClick={() => { setBack(true); setFrac(0.5); }} title="the trajectory after the last burn is kept; the state before each burn is (state after − Δv), propagated backward">only the past (keep the end)</button>
          </div>
        </div>
        <div className="row small">
          <label className="switch"><input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} /> Δv map next to the trajectory</label>
          {showMap && <label className="switch"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> map follows the time slider</label>}
        </div>
        <label className="row slider">
          Time <b>{tNowD.toFixed(3)} d</b>
          <span className="dim">{`${(T[0] * TSTAR_DAYS).toFixed(1)} … `}to {(plan.tEnd * TSTAR_DAYS).toFixed(1)} d ({stop(plan.status)})</span>
          <input type="range" min={0} max={1000} value={Math.round(frac * 1000)} onChange={(e) => setFrac(+e.target.value / 1000)} />
        </label>
        <div className="row">
          <button className="primary" disabled={!okTime(tNowD)} onClick={() => addBurn(tNowD)}>+ Δv at {tNowD.toFixed(2)} d</button>
          {burns.length > 0 && <button onClick={() => setBurns([])}>Remove all</button>}
          <label className="switch small"><input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} /> show the trajectory without burns</label>
        </div>
        <label className="row small step-sl" title="how much one press of a − / + button changes |Δv| (m/s) and the angles α, β (degrees)">−/+ button size
          <input type="range" min={-3} max={2} step={1} value={e10} onChange={(e) => setE10(+e.target.value)} />
          <span className="dim">{step >= 1 ? step.toFixed(0) : step} m/s · {astep >= 1 ? astep.toFixed(0) : astep}° per press</span>
        </label>
        {order.map((b) => {
          const r = plan.burns.find((x) => x.burn === b)!;
          const segIdx = plan.burns.filter((x) => x.reached && x.burn.tDays <= b.tDays).length;
          return (
            <div key={b.id} className={`burn ${sel === b.id ? 'sel' : ''} ${!b.on ? 'off' : ''}`} onClick={() => setSel(b.id)}>
              <div className="row">
                <span className="burn-tag" style={{ background: SEG_COL[segIdx % SEG_COL.length] }}>{label(b)}</span>
                <span>at</span><NumField value={b.tDays} dec={4} w={84} onCommit={(v) => upd(b.id, (x) => ({ ...x, tDays: Math.min(tMax, Math.max(tMin, v)) }))} /><span>d</span>
                <label className="switch small"><input type="checkbox" checked={b.on} onChange={(e) => upd(b.id, (x) => ({ ...x, on: e.target.checked }))} /> on</label>
                <button className="link small" onClick={(e) => { e.stopPropagation(); setBurns(burns.filter((x) => x.id !== b.id)); }}>remove</button>
              </div>
              <input type="range" className="burn-t" min={tMin} max={tMax} step={0.01} value={b.tDays} onChange={(e) => upd(b.id, (x) => ({ ...x, tDays: +e.target.value }))} />
              <div className="row small">
                <select value={b.frame} onChange={(e) => upd(b.id, (x) => ({ ...x, frame: e.target.value as DvFrame }))}>
                  {(Object.keys(FRAME_LABEL) as DvFrame[]).map((f) => <option key={f} value={f}>{FRAME_LABEL[f]}</option>)}
                </select>
                <button className="link small" onClick={() => jump(r.tau)}>go to</button>
              </div>
              <div className="nudge"><span>|Δv|</span>
                <button onClick={() => upd(b.id, (x) => ({ ...x, mag: r6(Math.max(0, x.mag - step)) }))}>−</button>
                <NumField value={b.mag} dec={4} onCommit={(v) => upd(b.id, (x) => ({ ...x, mag: Math.max(0, v) }))} />
                <button onClick={() => upd(b.id, (x) => ({ ...x, mag: r6(x.mag + step) }))}>+</button>
                <span className="dim small">m/s</span></div>
              <div className="nudge"><span>α</span>
                <button onClick={() => upd(b.id, (x) => ({ ...x, alpha: r6(x.alpha - astep) }))}>−</button>
                <NumField value={b.alpha} dec={3} onCommit={(v) => upd(b.id, (x) => ({ ...x, alpha: v }))} />
                <button onClick={() => upd(b.id, (x) => ({ ...x, alpha: r6(x.alpha + astep) }))}>+</button>
                <span className="dim small">° in-plane</span></div>
              <div className="nudge"><span>β</span>
                <button onClick={() => upd(b.id, (x) => ({ ...x, beta: r6(Math.max(-90, x.beta - astep)) }))}>−</button>
                <NumField value={b.beta} dec={3} onCommit={(v) => upd(b.id, (x) => ({ ...x, beta: Math.max(-90, Math.min(90, v)) }))} />
                <button onClick={() => upd(b.id, (x) => ({ ...x, beta: r6(Math.min(90, x.beta + astep)) }))}>+</button>
                <span className="dim small">° out of plane</span></div>
              <div className="dim small">α: {ALPHA_HINT[b.frame]} · β: {BETA_HINT[b.frame]}{back ? ' · directions measured on the velocity after the burn' : ''}</div>
              {b.note && <div className="small burn-note">{b.note}</div>}
              <div className="dim small">
                {COMP_LABEL[b.frame].map((c, i) => `${c} ${dvOf(b)[i].toFixed(3)}`).join(', ')} m/s
                {r.reached ? <> · C {r.CBefore!.toFixed(5)} → {r.CAfter!.toFixed(5)}{r.dvRot && <> · rotating x, y, z = {r.dvRot.map((v) => v.toFixed(2)).join(', ')} m/s</>}</>
                  : b.on ? (okTime(b.tDays) ? ' · not reached (the trajectory ends before this time)' : ' · not at the section time t = 0') : ' · off'}
              </div>
            </div>
          );
        })}
        {burns.length === 0 && <div className="dim small">Move the time slider (or tap the timeline) and press "+ Δv", or click on the Δv map, to place a maneuver; then set its size |Δv|, in-plane direction α and out-of-plane angle β.</div>}
        <div className="man-sum">
          <div>Total Δv <b>{plan.totalDv.toFixed(3)} m/s</b> in {plan.burns.filter((r) => r.reached).length} burn(s) · {back ? `starts ${(T[0] * TSTAR_DAYS).toFixed(2)} d, ` : ''}ends {(plan.tEnd * TSTAR_DAYS).toFixed(2)} d ({stop(plan.status)})</div>
          <div>{m >= userLen ? <span className="ok">Realises your word ({userLen} symbols from the section)</span> : <span className="warn">Your word: {m} of {userLen} symbols from the section</span>}
            {burns.some((b) => b.on) && <span className="dim"> · {sameWord ? 'same word as without burns' : 'changed symbols are outlined in red'}</span>}</div>
        </div>
        <div className="timeline">
          {timeline.map((e, q) => e.k === 'burn'
            ? <div key={'b' + q} className="tl burnmark" onClick={() => { setSel(e.b.id); jump(e.t); }}><span className="burn-tag small">{label(e.b)}</span><span className="dim">{(e.t * TSTAR_DAYS).toFixed(2)} d</span></div>
            : e.k === 'now'
              ? <div key={'n' + q} className="tl now">now</div>
              : (
                <div key={q} className={`tl ${e.t <= tNow ? '' : 'future'} ${changed(e.q) ? 'changed' : ''}`} onClick={() => jump(e.t)}>
                  <span className="chip" style={{ background: css(COLORS[e.id]), color: textOn(COLORS[e.id]) }}><Sym name={e.nm} /></span>
                  <span className="dim">{(e.t * TSTAR_DAYS).toFixed(2)} d</span>
                </div>
              ))}
          {(plan.status === 1 || plan.status === 2) && <div className="tl"><span className="dim">impact ★</span></div>}
        </div>
        {burns.some((b) => b.on) && (
          <details><summary className="small">Word without the burns</summary>
            <div className="small">{G.names.map((nm, q) => <span key={q}><Sym name={nm} /> </span>)}</div>
          </details>
        )}
        <label className="row slider">
          Horizon <b>{horizonDays.toFixed(0)} d</b>
          <input type="range" min={5} max={120} step={1} value={horizonDays} onChange={(e) => setHorizonDays(+e.target.value)} />
        </label>
        <div className="row">
          <button onClick={download}>Download maneuver plan (JSON)</button>
          <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(exportData(), null, 2)).then(() => setCopied('Copied'), () => setCopied('Copy blocked'))}>Copy JSON</button>
          {copied && <span className="dim small">{copied}</span>}
        </div>
        <div className="dim small">Words after a burn are classified with the new C (the burn changes the Jacobi constant). The regions drawn are those of the section C. Δv is applied as an instantaneous inertial velocity change in the selected model.</div>
      </div>
    </div>
  );
}
