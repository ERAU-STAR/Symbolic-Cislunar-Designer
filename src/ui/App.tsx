import { useEffect, useMemo, useRef, useState } from 'react';
import { RegionView } from './RegionView';
import { GraphView } from './GraphView';
import { CSlider, Chip } from './widgets';
import { ModelPanel, ModelQuick, modelOf, phaseText, useEpochInfo, type Perturb } from './ModelPanel';
import { jdOf, buildModel, type PhaseOverride } from '../core/modelSetup';
import { makeDyn } from '../core/models';
import { sectionOpts } from '../core/icmap';
import { fitMissionBurns } from '../core/missionFit';
import { MapScreen, type Pick } from './MapScreen';
import { TrajScreen } from './TrajScreen';
import { ManeuverScreen } from './ManeuverScreen';
import type { Burn } from '../core/maneuver';
import { MissionPanel } from './MissionPanel';
import { Splash } from './Splash';
import { tdbToIso, type Mission, type Crossing, type MissionBurn } from '../core/mission';
import { graphAt, NAMES, ID } from '../core/symbols';
import { edgePieces, widest, sectionStateOn, type Window } from '../core/boundary';
import type { Slice } from '../core/icmap';
import type { MapView } from './FineTune';
import { regimeIndex } from '../core/constants';

type Screen = 'word' | 'map' | 'traj' | 'man';

export function App() {
  const [screen, setScreen] = useState<Screen>('word');
  const [C, setC] = useState(3.1666);
  const [view, setView] = useState<'regions' | 'graph'>('regions');
  const [word, setWord] = useState<number[]>([]);
  const [perturb, setPerturb] = useState<Perturb>({ ecc: false, sun: false, inc: false, ephem: false });
  const [epoch, setEpoch] = useState('2026-04-05T01:08');
  const [horizonDays, setHorizonDays] = useState(65);
  const [coarse, setCoarse] = useState(false);
  const [win, setWin] = useState<Window | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [present, setPresent] = useState(1); // section = transition word[present-1] -> word[present]
  const [pieceIdx, setPieceIdx] = useState(0);
  const [slice, setSlice] = useState<Slice>({ mapping: 'rate', z: 0, psi3: 0 });
  const [mapView, setMapView] = useState<MapView | null>(null);
  const [burns, setBurns] = useState<Burn[]>([]);
  const [phaseOv, setPhaseOv] = useState<PhaseOverride | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [crossing, setCrossing] = useState<Crossing | null>(null);
  const [showMission, setShowMission] = useState(false);
  const [missionOverlay, setMissionOverlay] = useState(true);
  const pendingPiece = useRef<{ shape: string; s: number } | null>(null);
  const [splash, setSplash] = useState(true);
  const [focus, setFocus] = useState<{ id: number; nonce: number } | null>(null);
  const [fitBurns, setFitBurns] = useState(true);
  const [missionBusy, setMissionBusy] = useState('');

  const graph = useMemo(() => graphAt(regimeIndex(C)), [C]);
  const allowed = useMemo(() => {
    // a word cannot start inside the Earth or the Moon, and nothing follows an impact (E_C / M_C)
    if (!word.length) return new Set([...graph.active].filter((i) => i !== ID.EC && i !== ID.MC));
    const last = word[word.length - 1];
    if (last === ID.EC || last === ID.MC) return new Set<number>();
    return new Set([...(graph.adj.get(last) ?? [])].filter((i) => graph.active.has(i)));
  }, [graph, word]);
  // edges of the word that are not admissible at the current C (after moving the slider)
  const badSteps = useMemo(() => word.map((id, q) => (q === 0 ? !graph.active.has(id) : !graph.adj.get(word[q - 1])?.has(id))), [word, graph]);
  const model = modelOf(perturb);
  const p = Math.min(Math.max(1, present), Math.max(1, word.length - 1));
  const src = word[p - 1], tgt = word[p];
  const pieces = useMemo(() => (word.length >= 2 ? edgePieces(src, tgt, C) : []), [src, tgt, C, word.length]);
  useEffect(() => {
    // a section taken from a mission crossing picks the piece that contains it, otherwise the widest piece
    const pp = pendingPiece.current;
    if (pp) {
      const k = pieces.findIndex((pc) => pc.shape.id === pp.shape && pp.s >= pc.s0 - 0.5 && pp.s <= pc.s1 + 0.5);
      if (k >= 0) { setPieceIdx(k); pendingPiece.current = null; return; }
    }
    const w = widest(pieces); setPieceIdx(w ? pieces.indexOf(w) : 0);
  }, [pieces]);
  const piece = pieces[Math.min(pieceIdx, pieces.length - 1)] ?? null;
  const userF = useMemo(() => word.slice(p - 1), [word, p]);
  const userB = useMemo(() => (p > 1 ? word.slice(0, p).reverse() : []), [word, p]);
  const bodyEdge = word.length >= 2 && (src === ID.EC || src === ID.MC || tgt === ID.EC || tgt === ID.MC);
  const entryOk = word.length >= 2 && !badSteps.some(Boolean) && pieces.length > 0;
  const canMap = entryOk && model.valid;
  const anyPert = perturb.sun || perturb.ecc || perturb.inc || perturb.ephem;
  const jd = useMemo(() => jdOf(epoch), [epoch]);
  const E = useEpochInfo(epoch, anyPert);
  const Eeff = E && phaseOv && model.kind !== 'hfem' ? { ...E, ...phaseOv } : E;
  const phase = anyPert ? phaseText(model.kind, Eeff) + (phaseOv && model.kind !== 'hfem' ? ' (set by hand)' : '') : '';

  // take the section from a real mission crossing
  // the app epoch keeps whole seconds: burn times and fits are relative to that epoch
  const jdOfCrossing = (c: Crossing) => jdOf(tdbToIso(c.jd, true));
  const burnsFor = (c: Crossing): Burn[] => {
    if (!mission) return [];
    const j0 = jdOfCrossing(c);
    return mission.burns.filter((b) => Math.abs(b.jd - j0) < horizonDays).map((b, q) => ({
      id: q + 1, tDays: +(b.jd - j0).toFixed(6), frame: 'vnb-moon' as const, mag: +b.mag.toFixed(4), alpha: +b.alpha.toFixed(3), beta: +b.beta.toFixed(3), on: true,
      note: `detected ${b.mag.toFixed(2)} m/s`,
      // burns after the crossing change the future, burns before it the past; applied outwards from the section
      side: (b.jd >= j0 ? 'future' : 'past') as Burn['side'],
    })).sort((a, b) => Math.abs(a.tDays) - Math.abs(b.tDays));
  };
  /** re-solve the detected maneuvers in the app's HFEM so the designed trajectory passes through the real positions */
  const fittedBurnsFor = async (c: Crossing, onProgress?: (s: string) => void): Promise<Burn[]> => {
    const list = burnsFor(c);
    if (!mission || !c.piece || !list.length) return list;
    const j0 = jdOfCrossing(c);
    const dyn = makeDyn(await buildModel('hfem', j0, horizonDays));
    const s0 = sectionStateOn(c.piece, c.s, c.psi2, c.C, sectionOpts('hfem', dyn, { mapping: 'rate', z: c.z, psi3: c.psi3 }));
    if (!s0) return list;
    const F = await fitMissionBurns(dyn, s0, c.C, j0, horizonDays, list, mission, onProgress);
    return F.burns.map((b) => {
      const f = F.info.find((x) => x.id === b.id);
      if (f?.noData) return { ...b, note: `detected ${f.detected.toFixed(2)} m/s after the end of the data or too close to it: switched off` };
      return f ? { ...b, note: `fitted to the real trajectory: ${f.fitted.toFixed(2)} m/s (detected ${f.detected.toFixed(2)}), miss ${Number.isFinite(f.missKm) ? f.missKm.toFixed(2) + ' km' : '–'} at ${f.targetDays >= 0 ? '+' : ''}${f.targetDays.toFixed(2)} d${f.ok ? '' : ' (not converged: detected value kept as start)'}` } : b;
    });
  };
  const useCrossing = async (c: Crossing, withBurns: boolean, go: Screen = 'traj', fit = true, onProgress?: (s: string) => void) => {
    const list = withBurns ? (fit ? await fittedBurnsFor(c, onProgress) : burnsFor(c)) : null;
    if (!mission || !c.piece) return;
    const g = graphAt(regimeIndex(c.C));
    const w = [c.src, c.tgt];
    const k0 = mission.tokJd.findIndex((t) => t >= c.jd - 1e-9);
    for (let q = k0 + 1; q < mission.tokens.length && w.length < 6; q++) {
      const id = mission.tokens[q];
      if (!g.active.has(id) || !g.adj.get(w[w.length - 1])?.has(id)) break;
      w.push(id);
    }
    pendingPiece.current = { shape: c.piece.shape.id, s: c.s };
    setC(c.C); setWord(w); setPresent(1); setWin(null);
    setPerturb({ ecc: false, sun: false, inc: false, ephem: true }); setPhaseOv(null);
    setEpoch(tdbToIso(c.jd, true));
    setPick({ psi1: c.s, psi2: c.psi2 });
    setSlice({ mapping: 'rate', z: c.z, psi3: c.psi3 });
    setCrossing(c);
    if (list) setBurns(list);
    setShowMission(false);
    setScreen(go);
    return list;
  };
  // a mission maneuver: use the last usable crossing before it (with the mission's burns), then open its dv map
  const focusMissionBurn = async (b: MissionBurn) => {
    if (!mission) return;
    let c = crossing && crossing.jd < b.jd && b.jd - crossing.jd < horizonDays ? crossing : null;
    if (!c) {
      const before = mission.crossings.filter((x) => x.piece && x.jd < b.jd && b.jd - x.jd < horizonDays);
      const lunar = before.filter((x) => NAMES[x.tgt].startsWith('M_') && !NAMES[x.src].startsWith('M_'));
      c = lunar[lunar.length - 1] ?? before[before.length - 1] ?? null;
    }
    if (!c) { alert('No crossing usable as a section within the horizon before this maneuver. Increase the horizon or pick a crossing.'); return; }
    const list = (await useCrossing(c, true, 'man', fitBurns, setMissionBusy)) ?? [];
    setMissionBusy('');
    const id = list.find((x) => Math.abs(x.tDays - (b.jd - jdOfCrossing(c!))) < 1e-4)?.id;
    if (id) setFocus({ id, nonce: Date.now() });
  };
  // mission samples in the pulsating frame (whole mission on screen 1, +- horizon around the crossing on 3 and 4)
  const missionAll = useMemo(() => (mission ? { x: mission.puls.map((p) => p[0]), y: mission.puls.map((p) => p[1]) } : null), [mission]);
  const missionNear = useMemo(() => {
    if (!mission || !crossing) return missionAll;
    const x: number[] = [], y: number[] = [];
    mission.jd.forEach((j, k) => { if (Math.abs(j - crossing.jd) <= horizonDays) { x.push(mission.puls[k][0]); y.push(mission.puls[k][1]); } });
    return { x, y };
  }, [mission, crossing, horizonDays, missionAll]);
  const ovAll = missionOverlay ? missionAll : null, ovNear = missionOverlay ? missionNear : null;
  const marks = useMemo(() => {
    if (!mission || !missionOverlay || !piece || word.length < 2) return [];
    return mission.crossings.filter((c) => c.src === src && c.tgt === tgt && c.piece && c.piece.shape.id === piece.shape.id)
      .map((c) => ({ u: c.s, v: c.psi2, cur: !!crossing && crossing.jd === c.jd, label: `${mission.name} ${tdbToIso(c.jd).replace('T', ' ')} TDB · C ${c.C.toFixed(4)} · z ${c.z.toFixed(4)}, ψ₃ ${c.psi3.toFixed(2)}°` }));
  }, [mission, missionOverlay, piece, src, tgt, crossing, word.length]);

  const add = (id: number) => {
    if (!allowed.has(id)) return;
    setWord((w) => [...w, id]);
    if (word.length < 2) setPresent(1);
    setWin(null);
    setPick(null);
  };
  const setCAndReset = (c: number) => { setC(c); setWin(null); setPick(null); };

  const hint = !word.length
    ? 'Tap regions (or graph nodes) in order. Only admissible next symbols stay bright.'
    : word.length === 1
      ? 'Next: pick the region it crosses into. Any transition can be the section.'
      : !entryOk
        ? badSteps.some(Boolean)
          ? 'Some transitions are not admissible at this C (red). Undo them or change C.'
          : bodyEdge
            ? 'The section cannot be an impact (E_C / M_C). Tap another symbol to move the "now" marker.'
            : `The ${NAMES[src]} → ${NAMES[tgt]} boundary is not accessible at this C. Lower C or move the "now" marker.`
        : !model.valid
          ? 'This perturbation combination has no model. Open the Model menu to change it.'
          : `Ready: the section is ${NAMES[src]} → ${NAMES[tgt]} (green line)${p > 1 ? '; symbols before "now" are matched backward in time' : ''}. Tap a later symbol to move "now".${word[word.length - 1] === ID.EC || word[word.length - 1] === ID.MC ? ' The word ends with an impact, so nothing can follow it.' : ''}`;

  return (
    <div className="app">
      {splash && <Splash onStart={() => setSplash(false)} />}
      <header>
        <div className="brand"><img className="brand-icon" src="brand/logo-icon.png" alt="" onClick={() => setSplash(true)} title="start screen" />Symbolic Cislunar Designer <span className="ver">v0.16 · by Seur Gi Jo</span></div>
        <nav>
          <button className={showMission ? 'on' : ''} onClick={() => setShowMission((v) => !v)} title="load Artemis I/II or your own OEM / Horizons file">Missions{mission ? ` · ${mission.name}` : ''}</button>
          <button className={screen === 'word' ? 'on' : ''} onClick={() => setScreen('word')}>1 · Word</button>
          <button className={screen === 'map' ? 'on' : ''} disabled={!canMap} onClick={() => setScreen('map')}>2 · Symbolic map</button>
          <button className={screen === 'traj' ? 'on' : ''} disabled={!pick || !canMap} onClick={() => setScreen('traj')}>3 · Trajectory</button>
          <button className={screen === 'man' ? 'on' : ''} disabled={!pick || !canMap} onClick={() => setScreen('man')}>4 · Maneuvers{burns.length ? ` (${burns.length})` : ''}</button>
        </nav>
      </header>

      {showMission && (
        <MissionPanel mission={mission} setMission={(m) => { setMission(m); setCrossing(null); }} current={crossing} onUse={async (c, wb) => { await useCrossing(c, wb, 'traj', fitBurns, setMissionBusy); setMissionBusy(''); }} onBurn={focusMissionBurn}
          fit={fitBurns} setFit={setFitBurns} appBusy={missionBusy}
          overlay={missionOverlay} setOverlay={setMissionOverlay} onClose={() => setShowMission(false)} />
      )}

      {screen === 'word' && (
        <main className="word-screen">
          <div className="stage">
            <div className="seg overlay right">
              <button className={view === 'regions' ? 'on' : ''} onClick={() => setView('regions')}>Regions</button>
              <button className={view === 'graph' ? 'on' : ''} onClick={() => setView('graph')}>Graph</button>
            </div>
            <button className="overlay left model-btn" onClick={() => setShowModel((s) => !s)}>
              Model: <b className={model.valid ? '' : 'badtxt'}>{model.name}</b> ▾
            </button>
            {showModel && (
              <div className="overlay left model-pop">
                <ModelPanel p={perturb} set={setPerturb} epoch={epoch} setEpoch={setEpoch} />
              </div>
            )}
            {view === 'regions'
              ? <RegionView C={C} word={word} allowed={allowed} onPick={add} section={entryOk ? piece : null} overlay={ovAll} />
              : <GraphView graph={graph} word={word} allowed={allowed} onPick={add} />}
          </div>
          <CSlider C={C} onChange={setCAndReset} />
        </main>
      )}

      {screen === 'map' && canMap && (
        <main className="full">
          <MapScreen C={C} user={userF} userB={userB} pieces={pieces} pieceIdx={pieceIdx} setPieceIdx={setPieceIdx} horizonDays={horizonDays} setHorizonDays={setHorizonDays} coarse={coarse} setCoarse={setCoarse}
            win={win} setWin={setWin} pick={pick} onPick={(p) => { setPick(p); setScreen('traj'); }}
            modelKind={model.kind!} modelName={model.name} jd={jd} phase={phase} ov={phaseOv}
            modelControls={<ModelQuick p={perturb} set={setPerturb} epoch={epoch} setEpoch={setEpoch} ov={phaseOv} setOv={setPhaseOv} />}
            slice={slice} setSlice={setSlice} onMapState={setMapView} marks={marks} />
        </main>
      )}

      {screen === 'traj' && pick && (
        <main className="full">
          <TrajScreen C={C} pick={pick} piece={piece!} horizonDays={horizonDays} user={userF} userB={userB} coarse={coarse} modelName={model.name} modelKind={model.kind!} jd={jd} phase={phase} ov={phaseOv}
            modelControls={<ModelQuick p={perturb} set={setPerturb} epoch={epoch} setEpoch={setEpoch} ov={phaseOv} setOv={setPhaseOv} />}
            slice={slice} setSlice={setSlice} setPick={setPick} mapView={mapView} overlay={ovNear}
            onZoomMap={(a, b) => { setWin({ p1a: pick.psi1 - a / 2, p1b: pick.psi1 + a / 2, p2a: pick.psi2 - b / 2, p2b: pick.psi2 + b / 2 }); setScreen('map'); }} />
        </main>
      )}

      {screen === 'man' && pick && canMap && (
        <main className="full">
          <ManeuverScreen C={C} pick={pick} piece={piece!} horizonDays={horizonDays} setHorizonDays={setHorizonDays} user={userF} userB={userB} coarse={coarse}
            modelName={model.name} modelKind={model.kind!} jd={jd} phase={phase} ov={phaseOv}
            modelControls={<ModelQuick p={perturb} set={setPerturb} epoch={epoch} setEpoch={setEpoch} ov={phaseOv} setOv={setPhaseOv} />}
            slice={slice} burns={burns} setBurns={setBurns} overlay={ovNear} focus={focus} />
        </main>
      )}

      <footer className="wordbar">
        <div className="chips">
          {word.length === 0 && <span className="dim">Symbolic word</span>}
          {word.map((id, q) => (
            <span key={q} className={badSteps[q] ? 'bad' : ''}>
              {q > 0 && (q === p && word.length > 1 ? <span className="now-mark" title="section: now">│now</span> : <span className="arrow">→</span>)}
              <Chip id={id} n={q + 1} onClick={q > 0 ? () => { setPresent(q); setWin(null); setPick(null); } : undefined} />
            </span>
          ))}
        </div>
        <div className="actions">
          <button onClick={() => { setWord((w) => w.slice(0, -1)); setPresent((q) => Math.min(q, Math.max(1, word.length - 2))); setWin(null); setPick(null); }} disabled={!word.length} title="Remove last symbol">⌫ Undo</button>
          <button onClick={() => { setWord([]); setPresent(1); setWin(null); setPick(null); setScreen('word'); }} disabled={!word.length}>Clear</button>
          {screen === 'word' && <button className="primary" disabled={!canMap} onClick={() => setScreen('map')}>Find trajectories →</button>}
          {screen === 'traj' && <button onClick={() => setScreen('map')}>← Back to map</button>}
          {screen === 'traj' && <button className="primary" onClick={() => setScreen('man')}>Maneuvers →</button>}
          {screen === 'man' && <button onClick={() => setScreen('traj')}>← Back to trajectory</button>}
        </div>
        <div className="hint">{hint} <span className="dim">C = {C.toFixed(4)}, G<sup>({graph.regime})</sup> · word: {word.map((i) => NAMES[i]).join(' ')}</span></div>
      </footer>
    </div>
  );
}
