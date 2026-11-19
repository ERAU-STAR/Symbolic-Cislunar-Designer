// Screen 4: impulsive maneuvers on the chosen trajectory. Every change re-propagates
// the whole plan at once (one trajectory, a few ms to ~100 ms depending on the model).
// Sequential design: burns are applied in the order they are made. Each burn either changes the
// future (the state before it is kept) or the past (the state after it is kept; before = after - dv).
// A new burn is a draft: its time follows the time slider until "Done".
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sectionStateOn, type Piece } from '../core/boundary';
import { TSTAR_DAYS, LSTAR_KM, MU } from '../core/constants';
import { COLORS, css, textOn } from '../core/symbols';
import { matchLength, wordNames } from '../core/words';
import { buildModel, ovKey, type PhaseOverride } from '../core/modelSetup';
import { makeDyn, type ModelKind, type Dyn, type ModelParams } from '../core/models';
import { sectionOpts, type Slice } from '../core/icmap';
import { runPlanSeq, sideOf, FRAME_LABEL, COMP_LABEL, ALPHA_HINT, BETA_HINT, dvOf, type Burn, type BurnSide, type DvFrame } from '../core/maneuver';
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
const keep = { frame: 'rot' as 'rot' | 'inertial' | '3d', e: 0, sel: 0, showMap: true, newSide: 'future' as BurnSide, t: null as number | null };

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
  const [showMap, setShowMapS] = useState(keep.showMap);
  const setShowMap = (b: boolean) => { keep.showMap = b; setShowMapS(b); };
  const [newSide, setNewSideS] = useState<BurnSide>(keep.newSide); // side of the next burn
  const setNewSide = (b: BurnSide) => { keep.newSide = b; setNewSideS(b); };
  const [tSel, setTSelS] = useState<number | null>(keep.t); // time slider [days]; null = end of the trajectory
  const setTSel = (t: number | null) => { keep.t = t; setTSelS(t); };
  const [showGhost, setShowGhost] = useState(true);
  const [copied, setCopied] = useState('');
  void userB;

  const t0 = performance.now();
  const plan = useMemo(() => (s0 && dyn ? runPlanSeq(dyn, s0, C, horizonDays, burns) : null), [s0, dyn, C, horizonDays, burns]);
  const ms = performance.now() - t0;
  const ghost = useMemo(() => (s0 && dyn ? runPlanSeq(dyn, s0, C, horizonDays, []) : null), [s0, dyn, C, horizonDays]);
  const selBurn = burns.find((b) => b.id === sel) ?? null;

  // focus a burn (from the mission panel): select it, show its dv map, move the time slider there
  const focused = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === focused.current) return;
    const b = burns.find((x) => x.id === focus.id);
    if (!b) return;
    setSel(b.id); setShowMap(true); setTSel(b.tDays);
    focused.current = focus.nonce;
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // a selection that no longer exists (burns replaced) is dropped
  useEffect(() => { if (sel && !burns.some((b) => b.id === sel)) setSel(0); }, [burns, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s0 || !plan || !ghost || !dyn || !params) {
    return (
      <div className="traj-screen">
        <div className="traj-view empty">{!s0 ? `This point is forbidden at C = ${C.toFixed(4)}.` : `Loading the ${modelName} model…`}</div>
        <div className="traj-side">{modelControls}</div>
      </div>
    );
  }
  const T = plan.t, PP = plan.P, II = plan.I!, breaks = plan.breaks, n = T.length;
  const tMin = -horizonDays + 0.01, tMax = horizonDays - 0.01;
  const okTime = (t: number) => t > tMin && t < tMax && Math.abs(t) > 1e-4;
  const tEndD = plan.tEnd * TSTAR_DAYS, tStartD = (T[0] ?? 0) * TSTAR_DAYS;
  const tNowD = Math.min(tMax, Math.max(tMin, tSel ?? tEndD)), tNow = tNowD / TSTAR_DAYS;
  let upto = 1; for (let i = 1; i < n; i++) if (T[i] <= tNow + 1e-12) upto = i;
  const xs = PP.slice(0, upto + 1).map((p) => p[0]), ys = PP.slice(0, upto + 1).map((p) => p[1]);
  const G = display(ghost.tokens, ghost.times, coarse), F = display(plan.tokens, plan.times, coarse);
  // changed symbols: everything between the common beginning and the common end of the two words
  let pre = 0; while (pre < F.names.length && pre < G.names.length && F.names[pre] === G.names[pre]) pre++;
  let suf = 0; while (suf < F.names.length - pre && suf < G.names.length - pre && F.names[F.names.length - 1 - suf] === G.names[G.names.length - 1 - suf]) suf++;
  const anyOn = burns.some((b) => b.on);
  const changed = (q: number) => anyOn && q >= pre && q < F.names.length - suf;
  const sameWord = F.names.length === G.names.length && F.names.every((nm, q) => nm === G.names[q]);
  // your word is matched from the symbol at the section time
  const userLen = wordNames(user, coarse).length;
  let k0 = 0; for (let q = 0; q < plan.times.length; q++) if (plan.times[q] <= 0) k0 = q;
  const m = matchLength(plan.tokens.slice(k0), user, coarse);
  const stop = (st: number) => (st === 1 ? 'Moon impact' : st === 2 ? 'Earth impact' : 'horizon');

  const nextId = () => Math.max(0, ...burns.map((b) => b.id)) + 1;
  const upd = (id: number, f: (b: Burn) => Burn) => setBurns(burns.map((b) => (b.id === id ? f(b) : b)));
  /** a new burn is a draft at the time slider; only one draft at a time */
  const newDraft = (v?: { mag: number; alpha: number; beta: number }) => {
    if (!okTime(tNowD)) return;
    const id = nextId();
    setBurns([...burns.filter((b) => !b.draft), { id, tDays: +tNowD.toFixed(4), frame: 'vnb-moon', mag: v?.mag ?? 0, alpha: v?.alpha ?? 0, beta: v?.beta ?? 0, on: true, side: newSide, draft: true }]);
    setSel(id);
  };
  const done = (id: number) => { upd(id, (x) => ({ ...x, draft: false })); setSel(0); };
  const remove = (id: number) => { setBurns(burns.filter((x) => x.id !== id)); if (sel === id) setSel(0); };
  const onTime = (t: number) => {
    setTSel(t);
    if (selBurn?.draft && okTime(t)) upd(selBurn.id, (x) => ({ ...x, tDays: +t.toFixed(4) }));
  };
  const step = 10 ** e10, astep = 10 ** Math.min(1, e10);
  const r6 = (v: number) => +v.toFixed(6);
  const label = (b: Burn) => (b.draft ? 'new Δv' : `Δv${burns.filter((x) => !x.draft).indexOf(b) + 1}`);
  // the dv map: the selected burn (its time; a draft follows the slider), or a new burn at the time slider
  const selIdx = selBurn ? burns.indexOf(selBurn) : -1;
  const mapT = selBurn ? (selBurn.draft ? tNowD : selBurn.tDays) : tNowD;
  const mapPrior = selBurn ? burns.slice(0, selIdx).filter((b) => b.on) : burns.filter((b) => b.on && !b.draft);
  const mapSide: BurnSide = selBurn ? sideOf(selBurn) : newSide;
  const mapFrame: DvFrame = selBurn?.frame ?? 'vnb-moon';
  const onMapSet = (mag: number, alpha: number, beta: number) => {
    if (selBurn) upd(selBurn.id, (x) => ({ ...x, mag, alpha, beta, ...(x.draft ? { tDays: +mapT.toFixed(4) } : {}) }));
    else newDraft({ mag, alpha, beta });
  };

  const exportData = () => ({
    model: modelName, epoch_jd_tdb: modelKind === 'cr3bp' ? null : jd, phases: phase || null, C_section: C,
    design: 'sequential: burns applied in the order listed; "future" keeps the state before the burn, "past" keeps the state after it',
    section: { boundary: piece.shape.id, ...(piece.shape.unit === 'deg' ? { psi1_deg: pick.psi1 } : { s_ndim: pick.psi1 }), psi2_deg: pick.psi2, z_ndim: slice.z, psi3_deg: slice.psi3, ic_mapping: slice.mapping },
    section_state: s0, units: { length_km: LSTAR_KM, time_days_per_TU: TSTAR_DAYS, mu: MU }, horizon_days: horizonDays,
    burns: plan.burns.map((r, q) => ({
      order: q + 1, label: label(r.burn), draft: !!r.burn.draft, changes: sideOf(r.burn), on: r.burn.on, reached: r.reached, t_days: r.burn.tDays, frame: r.burn.frame,
      dv_mag_ms: r.dvMag, alpha_deg: r.burn.alpha, beta_deg: r.burn.beta,
      dv_components_ms: { [COMP_LABEL[r.burn.frame].join('')]: dvOf(r.burn) },
      dv_rotating_xyz_ms: r.dvRot ?? null, dv_inertial_kms: r.dvInertial ?? null, C_before: r.CBefore ?? null, C_after: r.CAfter ?? null,
      model_state_before: r.yBefore ?? null, model_state_after: r.yAfter ?? null,
    })),
    total_dv_ms: plan.totalDv, start_days: tStartD, end: { stop: stop(plan.status), days: tEndD },
    word_without_burns: G.names, word_with_burns: F.names, entry_days: F.t.map((t) => t * TSTAR_DAYS),
  });
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }));
    a.download = `maneuvers_${modelKind}_C${C.toFixed(4)}_${burns.length}burns.json`;
    a.click();
  };
  const jump = (tau: number) => onTime(+(tau * TSTAR_DAYS).toFixed(4));

  // timeline: words with burn markers and "now" in time order
  type TL = { k: 'tok'; nm: string; id: number; t: number; q: number } | { k: 'burn'; b: Burn; t: number } | { k: 'now'; t: number };
  const timeline: TL[] = [
    ...F.names.map((nm, q) => ({ k: 'tok' as const, nm, id: F.ids[q], t: F.t[q], q })),
    ...plan.burns.filter((r) => r.reached).map((r) => ({ k: 'burn' as const, b: r.burn, t: r.tau })),
    { k: 'now' as const, t: 0 },
  ].sort((a, b) => a.t - b.t || (a.k === 'tok' ? 1 : -1));

  // label of the burn at each break of the drawn trajectory (breaks are in time order, labels in design order)
  const reachedB = plan.burns.filter((r) => r.reached);
  const breakLabels = breaks.map((b) => { const t = T[b]; let best = reachedB[0], d = Infinity; for (const r of reachedB) { const e = Math.abs(r.tau - t); if (e < d) { d = e; best = r; } } return best ? label(best.burn) : ''; });
  const trajView = frame === 'rot'
    ? <RegionView C={C} overlay={overlay} traj={{ x: xs, y: ys, start: 0, breaks, breakLabels, ghost: showGhost && anyOn ? { x: ghost.P.map((p) => p[0]), y: ghost.P.map((p) => p[1]) } : undefined }}
        marker={[xs[xs.length - 1], ys[ys.length - 1]]} initialView={FULL_VIEW} />
    : frame === 'inertial'
      ? <Inertial P={II.slice(0, upto + 1)} breaks={breaks} />
      : <Suspense fallback={<div className="empty">Loading the 3D viewer…</div>}><Traj3D P={PP} I={II} start={0} upto={upto} C={C} piece={piece} zSec={slice.z} breaks={breaks} /></Suspense>;

  const sideButtons = (v: BurnSide, set: (s: BurnSide) => void) => (
    <div className="seg side-seg">
      <button className={v === 'future' ? 'on' : ''} onClick={(e) => { e.stopPropagation(); set('future'); }} title="the state before the burn is kept; the trajectory after it changes">changes the future →</button>
      <button className={v === 'past' ? 'on' : ''} onClick={(e) => { e.stopPropagation(); set('past'); }} title="the state after the burn is kept; the trajectory before it changes (state before = state after − Δv)">← changes the past</button>
    </div>
  );

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
            <div className="small map-for">{selBurn
              ? <>Δv map for <b>{label(selBurn)}</b>{selBurn.draft ? ' (follows the time slider until Done)' : ''} <button className="link small" onClick={() => setSel(0)}>show a new burn instead</button></>
              : <>Δv map for a <b>new burn</b> at the time slider · click the map to place it</>}</div>
            <DvMap dyn={dyn} params={params} modelKey={modelKey} s0={s0} C={C} horizonDays={horizonDays}
              prior={mapPrior} tDays={mapT} frame={mapFrame} side={mapSide}
              current={selBurn && Math.abs(selBurn.tDays - mapT) < 1e-3 ? selBurn : null}
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
        <label className="row small"><input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} /> Δv map next to the trajectory</label>
        <label className="row slider">
          Time <b>{tNowD.toFixed(3)} d</b>
          <span className="dim">{tStartD.toFixed(1)} … {tEndD.toFixed(1)} d ({stop(plan.status)})</span>
          <input type="range" min={tMin} max={tMax} step={0.01} value={tNowD} onChange={(e) => onTime(+e.target.value)} />
        </label>
        {!selBurn?.draft && (
          <div className="new-burn">
            <div className="row small"><span>Next burn</span>{sideButtons(newSide, setNewSide)}</div>
            <div className="row">
              <button className="primary" disabled={!okTime(tNowD)} onClick={() => newDraft()}>+ New Δv at {tNowD.toFixed(2)} d</button>
              {burns.length > 0 && <button onClick={() => { setBurns([]); setSel(0); }}>Remove all</button>}
            </div>
          </div>
        )}
        <label className="row small"><input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} /> show the trajectory without burns</label>
        <label className="row small step-sl" title="how much one press of a − / + button changes |Δv| (m/s) and the angles α, β (degrees)">−/+ button size
          <input type="range" min={-3} max={2} step={1} value={e10} onChange={(e) => setE10(+e.target.value)} />
          <span className="dim">{step >= 1 ? step.toFixed(0) : step} m/s · {astep >= 1 ? astep.toFixed(0) : astep}° per press</span>
        </label>
        {burns.map((b, q) => {
          const r = plan.burns[q];
          const segIdx = plan.burns.filter((x) => x.reached && x.burn.tDays <= b.tDays).length;
          const isSel = sel === b.id;
          return (
            <div key={b.id} className={`burn ${isSel ? 'sel' : ''} ${!b.on ? 'off' : ''} ${b.draft ? 'draft' : ''}`} onClick={() => { if (!isSel) { setSel(b.id); if (!b.draft) setTSel(b.tDays); } }}>
              <div className="row">
                <span className="burn-tag" style={{ background: b.draft ? '#f59e0b' : SEG_COL[segIdx % SEG_COL.length] }}>{label(b)}</span>
                <span>at</span><NumField value={b.tDays} dec={4} w={84} onCommit={(v) => { const t = Math.min(tMax, Math.max(tMin, v)); upd(b.id, (x) => ({ ...x, tDays: t })); if (isSel) setTSel(t); }} /><span>d</span>
                {!b.draft && <label className="switch small" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={b.on} onChange={(e) => upd(b.id, (x) => ({ ...x, on: e.target.checked }))} /> on</label>}
                <button className="link small" onClick={(e) => { e.stopPropagation(); remove(b.id); }}>{b.draft ? 'cancel' : 'remove'}</button>
              </div>
              {sideButtons(sideOf(b), (sd) => upd(b.id, (x) => ({ ...x, side: sd })))}
              {!b.draft && <input type="range" className="burn-t" min={tMin} max={tMax} step={0.01} value={b.tDays} onChange={(e) => { const t = +e.target.value; upd(b.id, (x) => ({ ...x, tDays: t })); if (isSel) setTSel(t); }} />}
              {b.draft && <div className="dim small">Move the time slider to choose where to burn, pick the Δv on the map or below, then press Done.</div>}
              <div className="row small">
                <select value={b.frame} onChange={(e) => upd(b.id, (x) => ({ ...x, frame: e.target.value as DvFrame }))}>
                  {(Object.keys(FRAME_LABEL) as DvFrame[]).map((f) => <option key={f} value={f}>{FRAME_LABEL[f]}</option>)}
                </select>
                {!b.draft && <button className="link small" onClick={() => jump(r.tau)}>go to</button>}
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
              <div className="dim small">α: {ALPHA_HINT[b.frame]} · β: {BETA_HINT[b.frame]}{sideOf(b) === 'past' ? ' · directions measured on the kept velocity (after the burn)' : ''}</div>
              {b.note && <div className="small burn-note">{b.note}</div>}
              <div className="dim small">
                {COMP_LABEL[b.frame].map((c, i) => `${c} ${dvOf(b)[i].toFixed(3)}`).join(', ')} m/s
                {r.reached ? <> · C {r.CBefore!.toFixed(5)} → {r.CAfter!.toFixed(5)}{r.dvRot && <> · rotating x, y, z = {r.dvRot.map((v) => v.toFixed(2)).join(', ')} m/s</>}</>
                  : b.on ? (okTime(b.tDays) ? ' · not reached (the trajectory does not exist at this time)' : ' · not at the section time t = 0') : ' · off'}
              </div>
              {b.draft
                ? <div className="row"><button className="primary" disabled={!r.reached} onClick={(e) => { e.stopPropagation(); done(b.id); }}>✓ Done</button><button onClick={(e) => { e.stopPropagation(); remove(b.id); }}>Cancel</button></div>
                : isSel && <div className="row"><button onClick={(e) => { e.stopPropagation(); setSel(0); }}>Close</button></div>}
            </div>
          );
        })}
        {burns.length === 0 && <div className="dim small">Move the time slider: the Δv map shows what a burn at that time would do. Click the map (or "+ New Δv") to place a burn, choose whether it changes the future or the past, set |Δv|, α and β, then press Done. Burns are applied in the order they are made; click a burn to see its map again.</div>}
        <div className="man-sum">
          <div>Total Δv <b>{plan.totalDv.toFixed(3)} m/s</b> in {plan.burns.filter((r) => r.reached).length} burn(s) · {tStartD.toFixed(2)} … {tEndD.toFixed(2)} d ({stop(plan.status)})</div>
          <div>{m >= userLen ? <span className="ok">Realises your word ({userLen} symbols from the section)</span> : <span className="warn">Your word: {m} of {userLen} symbols from the section</span>}
            {anyOn && <span className="dim"> · {sameWord ? 'same word as without burns' : 'changed symbols are outlined in red'}</span>}</div>
        </div>
        <div className="timeline">
          {timeline.map((e, q) => e.k === 'burn'
            ? <div key={'b' + q} className="tl burnmark" onClick={() => { setSel(e.b.id); jump(e.t); }}><span className="burn-tag small" style={e.b.draft ? { background: '#f59e0b' } : undefined}>{label(e.b)}</span><span className="dim">{(e.t * TSTAR_DAYS).toFixed(2)} d</span></div>
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
        {anyOn && (
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
