import { useEffect, useState } from 'react';
import type { ModelKind } from '../core/models';
import { epochInfo, jdOf, closestEpoch, EPOCH_MAX, type EpochInfo, type PhaseOverride } from '../core/modelSetup';

// Perturbation switches -> dynamical model (no jargon on the switches).
export interface Perturb { ecc: boolean; sun: boolean; inc: boolean; ephem: boolean }
export interface ModelChoice { kind: ModelKind | null; name: string; valid: boolean; note: string }

export function modelOf(p: Perturb): ModelChoice {
  if (p.ephem) return { kind: 'hfem', name: 'HFEM', valid: true, note: 'Full ephemeris: Earth, Moon and Sun from JPL DE421.' };
  if (!p.sun && !p.ecc && !p.inc) return { kind: 'cr3bp', name: 'CR3BP', valid: true, note: 'Circular Earth-Moon problem; C is conserved.' };
  if (!p.sun && p.ecc && !p.inc) return { kind: 'er3bp', name: 'ER3BP', valid: true, note: 'Eccentric Moon orbit (e = 0.055); phase f0 from the epoch.' };
  if (p.sun && !p.ecc && !p.inc) return { kind: 'hr4bp', name: 'HR4BP', valid: true, note: 'Sun added; Earth-Moon on the circular Hill variation orbit.' };
  if (p.sun && p.ecc && !p.inc) return { kind: 'qhr4bp_ecc', name: 'QHR4BP (eccentricity)', valid: true, note: 'Sun + quasi-periodic eccentric Earth-Moon orbit (theta1, theta2).' };
  if (p.sun && !p.ecc && p.inc) return { kind: 'qhr4bp_inc', name: 'QHR4BP (inclination)', valid: true, note: 'Sun + quasi-periodic inclined Earth-Moon orbit (theta3, theta2).' };
  return { kind: null, name: 'no model', valid: false, note: p.inc && !p.sun ? "The inclined Earth-Moon orbit model needs the Sun's gravity. Turn it on too." : 'Eccentricity and inclination together are only in the full ephemeris. Turn on "Full ephemeris".' };
}

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1) + '°';
export function phaseText(kind: ModelKind | null, E: EpochInfo | null): string {
  if (!E || !kind) return '';
  switch (kind) {
    case 'er3bp': return `f0 = ${deg(E.f0)}`;
    case 'hr4bp': return `theta2 = ${deg(E.hrPhase * 2 * Math.PI)}`;
    case 'qhr4bp_ecc': return `theta1 = ${deg(E.ecc[0])}, theta2 = ${deg(E.ecc[1])}`;
    case 'qhr4bp_inc': return `theta3 = ${deg(E.inc[0])}, theta2 = ${deg(E.inc[1])}`;
    case 'hfem': return `f0 = ${deg(E.f0)}, theta1 = ${deg(E.ecc[0])}, theta2 = ${deg(E.ecc[1])}, theta3 = ${deg(E.inc[0])}`;
    default: return '';
  }
}

export function useEpochInfo(epoch: string, on: boolean) {
  const [E, setE] = useState<EpochInfo | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    epochInfo(jdOf(epoch)).then((e) => live && setE(e), () => live && setE(null));
    return () => { live = false; };
  }, [epoch, on]);
  return on ? E : null;
}

export function ModelPanel({ p, set, epoch, setEpoch }: {
  p: Perturb; set: (p: Perturb) => void; epoch: string; setEpoch: (s: string) => void;
}) {
  const m = modelOf(p);
  const any = p.sun || p.ecc || p.inc || p.ephem;
  const E = useEpochInfo(epoch, any);
  const sw = (key: keyof Perturb, label: string, disabled = false) => (
    <label className={`switch ${disabled ? 'off' : ''}`}>
      <input type="checkbox" checked={p[key]} disabled={disabled} onChange={(e) => set({ ...p, [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="model-panel">
      <div className="mp-title">Perturbations</div>
      {sw('ecc', "Moon's orbital eccentricity", p.ephem)}
      {sw('sun', "Sun's gravity", p.ephem)}
      {sw('inc', "Moon's orbital inclination", p.ephem)}
      {sw('ephem', 'Full ephemeris (everything)')}
      <div className={`mp-model ${m.valid ? '' : 'bad'}`}>Model: <b>{m.name}</b></div>
      <div className="mp-note">{m.note}</div>
      {any && (
        <label className="epoch">
          Epoch (TDB)
          <input type="datetime-local" step={1} min="2011-01-01T00:00" max={EPOCH_MAX} value={epoch} onChange={(e) => e.target.value && setEpoch(e.target.value)} />
        </label>
      )}
      {any && m.valid && <div className="mp-phase">{phaseText(m.kind, E) || 'loading phases…'}</div>}
      {any && <div className="mp-note">With perturbations C is not conserved. C is set at the section in each model's own Earth-Moon frame (same position and angular-rate-normalised velocity); the regions and the graph show the CR3BP reference.</div>}
    </div>
  );
}

/** compact model + epoch switcher for the map / trajectory screens */
const QUICK: { label: string; p: Perturb }[] = [
  { label: 'CR3BP', p: { ecc: false, sun: false, inc: false, ephem: false } },
  { label: 'ER3BP', p: { ecc: true, sun: false, inc: false, ephem: false } },
  { label: 'HR4BP', p: { ecc: false, sun: true, inc: false, ephem: false } },
  { label: 'QHR4BP-e', p: { ecc: true, sun: true, inc: false, ephem: false } },
  { label: 'QHR4BP-i', p: { ecc: false, sun: true, inc: true, ephem: false } },
  { label: 'HFEM', p: { ecc: false, sun: false, inc: false, ephem: true } },
];
const same = (a: Perturb, b: Perturb) => a.ecc === b.ecc && a.sun === b.sun && a.inc === b.inc && a.ephem === b.ephem;
function shiftEpoch(s: string, days: number) {
  const ms = Date.parse((s.length === 16 ? s + ':00' : s) + 'Z') + days * 864e5;
  return new Date(ms).toISOString().slice(0, s.length === 16 ? 16 : 19);
}

const R2D = 180 / Math.PI;
type PhaseSpec = { label: string; title: string; get: (E: EpochInfo) => number; set: (ov: PhaseOverride, E: EpochInfo, deg: number) => PhaseOverride };
const PHASES: Partial<Record<ModelKind, PhaseSpec[]>> = {
  er3bp: [{ label: 'f₀', title: "Moon's true anomaly at the epoch", get: (E) => E.f0 * R2D, set: (o, _E, d) => ({ ...o, f0: d / R2D }) }],
  hr4bp: [{ label: 'θ₂', title: 'Sun phase (angle of the Sun in the Earth-Moon frame)', get: (E) => E.hrPhase * 360, set: (o, _E, d) => ({ ...o, hrPhase: d / 360 }) }],
  qhr4bp_ecc: [
    { label: 'θ₁', title: 'eccentricity (apsidal) phase of the quasi-periodic Earth-Moon orbit', get: (E) => E.ecc[0] * R2D, set: (o, E, d) => ({ ...o, ecc: [d / R2D, (o.ecc ?? E.ecc)[1]] }) },
    { label: 'θ₂', title: 'Sun phase', get: (E) => E.ecc[1] * R2D, set: (o, E, d) => ({ ...o, ecc: [(o.ecc ?? E.ecc)[0], d / R2D] }) },
  ],
  qhr4bp_inc: [
    { label: 'θ₃', title: 'inclination (nodal) phase of the quasi-periodic Earth-Moon orbit', get: (E) => E.inc[0] * R2D, set: (o, E, d) => ({ ...o, inc: [d / R2D, (o.inc ?? E.inc)[1]] }) },
    { label: 'θ₂', title: 'Sun phase', get: (E) => E.inc[1] * R2D, set: (o, E, d) => ({ ...o, inc: [(o.inc ?? E.inc)[0], d / R2D] }) },
  ],
};
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** compact model + epoch switcher for the map / trajectory screens, with hand-set phase angles */
export function ModelQuick({ p, set, epoch, setEpoch, ov, setOv }: { p: Perturb; set: (p: Perturb) => void; epoch: string; setEpoch: (s: string) => void; ov?: PhaseOverride | null; setOv?: (o: PhaseOverride | null) => void }) {
  const any = p.sun || p.ecc || p.inc || p.ephem;
  const kind = modelOf(p).kind;
  const E0 = useEpochInfo(epoch, any);
  const specs = kind ? PHASES[kind] : undefined;
  const custom = !!ov && !!specs;
  const Eeff = E0 && ov ? ({ ...E0, ...ov } as EpochInfo) : E0;
  // slider values are local while dragging; the model is rebuilt 250 ms after the last move
  const [draft, setDraft] = useState<PhaseOverride | null>(ov ?? null);
  useEffect(() => { setDraft(ov ?? null); }, [ov]);
  useEffect(() => {
    if (!setOv || !draft || JSON.stringify(draft) === JSON.stringify(ov)) return;
    const id = setTimeout(() => setOv(draft), 250);
    return () => clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const Ed = E0 && draft ? ({ ...E0, ...draft } as EpochInfo) : Eeff;
  const [found, setFound] = useState('');
  const findEpoch = async () => {
    if (!kind || !E0) return;
    const T = { ...E0, ...(draft ?? ov ?? {}) } as EpochInfo;
    setFound('searching 2020–2035…');
    const r = await closestEpoch(kind, T);
    const iso = new Date((r.jd - 2440587.5) * 864e5).toISOString().slice(0, 16);
    setEpoch(iso); setOv?.(null);
    setFound(`epoch set to ${iso.replace('T', ' ')} TDB, phase angles within ${r.errDeg.toFixed(1)}° (${r.angles.map((a) => ((a % 360) + 360) % 360).map((a) => a.toFixed(1) + '°').join(', ')}); HFEM now runs at this date`);
  };
  return (
    <div className="model-quick">
      <div className="seg wrap">
        {QUICK.map((q) => (
          <button key={q.label} className={same(q.p, p) ? 'on' : ''} onClick={() => set(q.p)}>{q.label}</button>
        ))}
      </div>
      <div className={`row epoch-row ${any ? '' : 'dimmed'}`} title={any ? '' : 'CR3BP does not depend on the epoch'}>
        <span>Epoch</span>
        <button onClick={() => setEpoch(shiftEpoch(epoch, -7))}>−7 d</button>
        <button onClick={() => setEpoch(shiftEpoch(epoch, -1))}>−1 d</button>
        <input type="datetime-local" step={1} min="2011-01-01T00:00" max={EPOCH_MAX} value={epoch} onChange={(e) => e.target.value && setEpoch(e.target.value)} />
        <button onClick={() => setEpoch(shiftEpoch(epoch, 1))}>+1 d</button>
        <button onClick={() => setEpoch(shiftEpoch(epoch, 7))}>+7 d</button>
      </div>
      {specs && setOv && E0 && (
        <div className="phase-box">
          <label className="switch small"><input type="checkbox" checked={custom} onChange={(e) => setOv(e.target.checked ? {} : null)} /> set the phase angles by hand (instead of from the epoch)</label>
          {specs.map((sp) => {
            const v = wrap360(sp.get(custom ? Ed! : E0));
            return (
              <label key={sp.label} className={`row slider phase ${custom ? '' : 'dimmed'}`} title={sp.title}>
                <span><b>{sp.label}</b> = {v.toFixed(1)}° <span className="dim">{sp.title}{custom ? ` · epoch value ${wrap360(sp.get(E0)).toFixed(1)}°` : ''}</span></span>
                <input type="range" min={0} max={360} step={0.5} value={v} disabled={!custom}
                  onChange={(e) => setDraft(sp.set(draft ?? {}, E0, +e.target.value))} />
              </label>
            );
          })}
        </div>
      )}
      {specs && setOv && E0 && custom && (
        <div className="row small"><button onClick={findEpoch} title="search the 2020-2035 phase table for the date whose phases are closest to these angles">→ closest real epoch</button>
          <span className="dim">so that HFEM (real ephemeris) can be run with about the same geometry</span></div>
      )}
      {found && <div className="dim small">{found}</div>}
      {kind === 'hfem' && <div className="dim small">HFEM phases come from the ephemeris at the epoch (hand-set angles are not used; use "closest real epoch" in the other models first).</div>}
    </div>
  );
}
