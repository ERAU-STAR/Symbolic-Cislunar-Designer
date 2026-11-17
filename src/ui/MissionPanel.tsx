// Real missions: load a built-in one or an OEM / Horizons file, see its symbolic word,
// its boundary crossings (each usable as the section) and the maneuvers found in it.
import { useMemo, useRef, useState } from 'react';
import { parseMission, processMission, tdbToIso, BUILTIN, type Mission, type Crossing, type MissionBurn } from '../core/mission';
import { NAMES, COLORS, css, textOn, isLunar } from '../core/symbols';
import { Sym } from './widgets';

const dataUrl = (f: string) => new URL(`data/missions/${f}`, document.baseURI).toString();

interface Props {
  mission: Mission | null;
  setMission: (m: Mission | null) => void;
  current: Crossing | null;
  onUse: (c: Crossing, withBurns: boolean) => void;
  onBurn: (b: MissionBurn) => void;
  fit: boolean;
  setFit: (b: boolean) => void;
  appBusy: string;
  overlay: boolean;
  setOverlay: (b: boolean) => void;
  onClose: () => void;
}

type Filter = 'lunar' | 'usable' | 'all';

export function MissionPanel({ mission, setMission, current, onUse, onBurn, fit, setFit, appBusy, overlay, setOverlay, onClose }: Props) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [thr, setThr] = useState(1);
  const [filter, setFilter] = useState<Filter>('lunar');
  const [withBurns, setWithBurns] = useState(true);
  const [showAllWord, setShowAllWord] = useState(false);
  const lastText = useRef<{ text: string; name: string } | null>(null);

  const run = async (text: string, name: string) => {
    setErr(''); setBusy('reading…');
    lastText.current = { text, name };
    try {
      const raw = parseMission(text, name);
      const m = await processMission(raw, { burnThreshold: thr, onProgress: setBusy });
      setMission(m);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy('');
  };
  const loadBuiltin = async (b: (typeof BUILTIN)[number]) => {
    setBusy(`downloading ${b.name}…`);
    try { const r = await fetch(dataUrl(b.file)); if (!r.ok) throw new Error(`could not load ${b.file}`); await run(await r.text(), b.name); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); setBusy(''); }
  };
  const loadFile = async (f: File) => run(await f.text(), f.name.replace(/\.[^.]+$/, ''));

  const crossings = useMemo(() => {
    if (!mission) return [];
    const c = mission.crossings;
    if (filter === 'all') return c;
    if (filter === 'usable') return c.filter((x) => x.piece);
    return c.filter((x) => x.piece && !isLunar(x.src) && isLunar(x.tgt));
  }, [mission, filter]);

  const chip = (id: number) => <span className="chip" style={{ background: css(COLORS[id]), color: textOn(COLORS[id]) }}><Sym name={NAMES[id]} /></span>;
  const W = showAllWord ? 100000 : 60;

  return (
    <div className="mission-pop">
      <div className="row"><b>Real missions</b><span className="dim small">built-in: Artemis I/II · any other mission: load a CCSDS OEM or JPL Horizons vector table (Earth- or Moon-centred, km and km/s)</span>
        <button className="link" style={{ marginLeft: 'auto' }} onClick={onClose}>close ✕</button></div>
      <div className="row">
        {BUILTIN.map((b) => <button key={b.id} disabled={!!busy} onClick={() => loadBuiltin(b)} title={b.note}>{b.name}</button>)}
        <label className="filebtn">Load a file…<input type="file" accept=".txt,.oem,.csv,.xml,*" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} /></label>
      </div>
      <div className="row small">
        <label>maneuver threshold <input type="number" min={0.05} step={0.1} value={thr} style={{ width: 60 }} onChange={(e) => setThr(Math.max(0.01, +e.target.value))} /> m/s</label>
        {lastText.current && <button className="link small" disabled={!!busy} onClick={() => run(lastText.current!.text, lastText.current!.name)}>re-detect</button>}
        {busy && <span className="dim">{busy}</span>}
        {err && <span className="badtxt">{err}</span>}
      </div>
      {mission && (
        <>
          <div className="mission-sum small">
            <b>{mission.name}</b> · {mission.source}, {mission.frame}, centre {mission.center} · {mission.jd.length} states · {tdbToIso(mission.jd[0], false)} … {tdbToIso(mission.jd[mission.jd.length - 1], false)} TDB
            · C from {Math.min(...mission.C).toFixed(3)} to {Math.max(...mission.C).toFixed(3)}
            <label className="switch" style={{ marginLeft: 8 }}><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> draw it on the screens</label>
          </div>
          <div className="small"><b>Symbolic word</b> ({mission.tokens.length} symbols; each sample classified at its own C)</div>
          <div className="mission-word">
            {mission.tokens.slice(0, W).map((id, q) => (
              <span key={q} className="mw" title={tdbToIso(mission.tokJd[q])}>{chip(id)}<span className="dim">{tdbToIso(mission.tokJd[q], false).slice(5, 16).replace('T', ' ')}</span></span>
            ))}
            {mission.tokens.length > W && <button className="link small" onClick={() => setShowAllWord(true)}>show all {mission.tokens.length}</button>}
          </div>
          <div className="row small">
            <b>Crossings</b>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="lunar">into the lunar region (M_*)</option>
              <option value="usable">all usable as a section</option>
              <option value="all">all</option>
            </select>
            <label className="switch"><input type="checkbox" checked={withBurns} onChange={(e) => setWithBurns(e.target.checked)} /> also load the maneuvers into screen 4</label>
            <label className="switch" title="re-solve each maneuver in the app's HFEM so that the trajectory passes through the real position after it (the detected impulses alone drift away)"><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> fit them to the real trajectory</label>
            {appBusy && <span className="dim">{appBusy}</span>}
          </div>
          <div className="mission-table">
            <table>
              <thead><tr><th /><th>date (TDB)</th><th>edge</th><th>C</th><th>ψ₁ / s</th><th>ψ₂</th><th>z</th><th>ψ₃</th></tr></thead>
              <tbody>
                {crossings.slice(0, 400).map((c, q) => (
                  <tr key={q} className={current && current.jd === c.jd ? 'cur' : ''}>
                    <td>{c.piece ? <button className="primary" disabled={!!appBusy} onClick={() => onUse(c, withBurns)}>Use</button> : <span className="dim" title="this crossing is not on a section boundary piece at its C">–</span>}</td>
                    <td>{tdbToIso(c.jd).replace('T', ' ')}</td>
                    <td>{chip(c.src)} → {chip(c.tgt)}</td>
                    <td>{c.C.toFixed(4)}</td>
                    <td>{Number.isFinite(c.s) ? c.s.toFixed(3) : '–'}</td>
                    <td>{c.psi2.toFixed(2)}°</td>
                    <td>{c.z.toFixed(4)}</td>
                    <td>{c.psi3.toFixed(2)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {crossings.length > 400 && <div className="dim small">first 400 of {crossings.length}</div>}
          </div>
          <div className="small"><b>Maneuvers found</b> — click one to open its Δv map with the executed Δv marked ({mission.burns.length}; velocity jumps against HFEM propagation between samples, as one impulse at the middle of each burn; directions in VNB about the Moon)</div>
          <div className="mission-table">
            <table>
              <thead><tr><th /><th>date (TDB)</th><th>|Δv| m/s</th><th>α</th><th>β</th><th>to Moon km</th><th>to Earth km</th></tr></thead>
              <tbody>
                {mission.burns.map((b, q) => (
                  <tr key={q} className="clickable" onClick={() => onBurn(b)} title="open the Δv map at this maneuver (screen 4) with the executed Δv marked">
                    <td><button disabled={!!appBusy}>Δv map →</button></td>
                    <td>{tdbToIso(b.jd).replace('T', ' ')}</td><td>{b.mag.toFixed(3)}</td><td>{b.alpha.toFixed(1)}°</td><td>{b.beta.toFixed(1)}°</td><td>{b.rMoon.toFixed(0)}</td><td>{b.rEarth.toFixed(0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dim small">Use a crossing: C, the word, the section point (ψ₁ or s, ψ₂, z, ψ₃), the HFEM model and the epoch are set from it, so screens 2–4 start from the real state; the real trajectory is drawn in purple for comparison. Samples are hourly (Horizons) or minutes apart (OEM); close to the Earth or in low lunar orbit the point-mass HFEM cannot separate small maneuvers from model error, so raise the threshold there.</div>
        </>
      )}
    </div>
  );
}
