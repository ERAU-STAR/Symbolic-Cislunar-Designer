// Stage 2 of the maneuver design: symbolic map of the dv space for a burn at one time.
// Grid over (alpha, |dv|) at fixed beta, or (alpha, beta) at fixed |dv|. Forward design: every point is
// propagated forward from the burn (earlier burns applied) and coloured by the word after the burn.
// Backward design: the trajectory after the burn is kept (later burns applied) and every point is
// propagated backward, coloured by the word before the burn (read backward in time).
import { useEffect, useMemo, useRef, useState } from 'react';
import { runMap, displayIndex, workerCount, type MapState, type PointResult, type RunHandle } from '../core/mapEngine';
import type { Piece, Window } from '../core/boundary';
import { TSTAR_DAYS } from '../core/constants';
import { wordNames } from '../core/words';
import { isLunar } from '../core/symbols';
import { prepareDvMap, ALPHA_HINT, BETA_HINT, type Burn, type DvFrame } from '../core/maneuver';
import type { Dyn, ModelParams } from '../core/models';
import { buildLegend, OTHER, type Mode } from './palette';
import { Sym } from './widgets';

type Axes = 'amag' | 'ab';
const keep = { axes: 'amag' as Axes, magMax: 30, alpha: [-180, 180] as [number, number], beta: [-60, 60] as [number, number], fixedBeta: 0, fixedMag: 10, levels: 2, mode: 'classes' as Mode, maxSym: 8 };

interface Props {
  dyn: Dyn; params: ModelParams; modelKey: string; s0: number[]; C: number; horizonDays: number;
  burns: Burn[]; skipId: number | null; tDays: number; frame: DvFrame; backward: boolean;
  current: { mag: number; alpha: number; beta: number } | null;
  piece: Piece; user: number[]; coarse: boolean;
  onSet: (mag: number, alpha: number, beta: number) => void;
  /** fit the map to an executed burn: (alpha, |dv|) axes, |dv| range covering it, beta fixed at its value */
  focus?: { nonce: number; mag: number; beta: number } | null;
}

export function DvMap({ dyn, params, modelKey, s0, C, horizonDays, burns, skipId, tDays, frame, backward, current, piece, user, coarse, onSet, focus }: Props) {
  const [axes, setAxes] = useState<Axes>(keep.axes);
  const [magMax, setMagMax] = useState(keep.magMax);
  const [alphaW, setAlphaW] = useState<[number, number]>(keep.alpha);
  const [betaW, setBetaW] = useState<[number, number]>(keep.beta);
  const [fixedBeta, setFixedBeta] = useState(keep.fixedBeta);
  const [fixedMag, setFixedMag] = useState(keep.fixedMag);
  const [levels, setLevels] = useState(keep.levels);
  const [modeS, setMode] = useState<Mode>(keep.mode);
  const mode: Mode = backward ? 'classes' : modeS;
  const [maxSym, setMaxSym] = useState(keep.maxSym);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [state, setState] = useState<MapState | null>(null);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState('');
  useEffect(() => {
    if (!focus) return;
    const nice = (v: number) => { const e = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / e) * e; };
    setAxes('amag'); setMagMax(Math.max(30, nice(focus.mag * 1.5))); setFixedBeta(+focus.beta.toFixed(2)); setAlphaW([-180, 180]);
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { Object.assign(keep, { axes, magMax, alpha: alphaW, beta: betaW, fixedBeta, fixedMag, levels, mode: modeS, maxSym }); }, [axes, magMax, alphaW, betaW, fixedBeta, fixedMag, levels, modeS, maxSym]);

  // the map depends on the time, the frame and the other burns, not on the dv of the burn being designed
  const others = burns.filter((b) => b.id !== skipId && b.on);
  const tq = +tDays.toFixed(3);
  const prepKey = JSON.stringify([tq, frame, backward, others.map((b) => [b.tDays, b.frame, b.mag, b.alpha, b.beta]), s0, C, horizonDays]);
  const prep = useMemo(() => prepareDvMap(dyn, s0, C, horizonDays, burns, skipId, tq, frame, backward), [dyn, prepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const win: Window = axes === 'amag' ? { p1a: alphaW[0], p1b: alphaW[1], p2a: 0, p2b: magMax } : { p1a: alphaW[0], p1b: alphaW[1], p2a: betaW[0], p2b: betaW[1] };
  const preLen = prep ? wordNames(prep.prefix, false).length : 0;

  const run = useRef<RunHandle | null>(null);
  useEffect(() => {
    if (!prep) { setState(null); setMsg(''); return; }
    const id = setTimeout(() => {
      run.current?.cancel();
      const t0 = performance.now();
      const fb = fixedBeta, fm = fixedMag;
      const H = horizonDays / TSTAR_DAYS;
      const h = runMap({
        C, tEnd: backward ? -H : H, user, userB: [], piece, sopt: { z: 0, psi3: 0, kappa: 1, vscale: 1 }, axes: 'spsi', fixed: { s: 0, psi2: 0 },
        win, base: 12, levels, model: params, modelKey,
        custom: {
          key: JSON.stringify([prepKey, axes, axes === 'amag' ? fb : fm]),
          state: (u, v) => (axes === 'amag' ? prep.state(v, u, fb) : prep.state(fm, u, v)),
          t0: prep.tau, stride: prep.n, maxSym, prefix: prep.prefix,
        },
      }, (s, m) => { setState(s); setMsg(m); setTick((t) => t + 1); });
      run.current = h;
      h.promise.then(() => setMsg((m) => `${m} · ${((performance.now() - t0) / 1000).toFixed(1)} s`), () => {});
    }, 350);
    return () => { clearTimeout(id); run.current?.cancel(); };
  }, [prep, axes, magMax, alphaW[0], alphaW[1], betaW[0], betaW[1], fixedBeta, fixedMag, levels, maxSym, modelKey, horizonDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // word on the designed side of the burn (forward: after it; backward: before it, read backward)
  const wordOf = useMemo(() => (t: number[], status: number, co: boolean) => {
    const names = wordNames(t, co);
    const pre = wordNames(prep?.prefix ?? [], co).length;
    const post = names.slice(Math.max(0, pre - 1));
    let w = backward ? '← ' + post.join(' ') : post.join(' ');
    if (status === 1 || status === 2) w += '*';
    else if (status === 3) w += ' …';
    else if (t.length && isLunar(t[t.length - 1])) w += ' (M at the end)';
    return w;
  }, [prep, backward]);
  const legend = useMemo(() => {
    if (!state) return null;
    const counts = new Map<PointResult, number>();
    const n = state.n1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = displayIndex(state, i, j); if (k < 0) continue;
      const r = state.res.get(k); if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    return buildLegend([...counts.keys()], counts, mode, coarse, user, [], { maxClasses: 15, depth: 0, highlight, scheme: 'distinct', wordOf });
  }, [state, tick, mode, coarse, highlight, wordOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drawing
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(420);
  useEffect(() => {
    const el = box.current!;
    const fit = () => setSide(Math.max(220, Math.min(el.clientWidth, Math.round(window.innerHeight * 0.55))));
    const ro = new ResizeObserver(fit); ro.observe(el); window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, []);
  const M = { l: 46, r: 8, t: 8, b: 38 };
  const cur = current ? (axes === 'amag' ? { u: current.alpha, v: current.mag } : { u: current.alpha, v: current.beta }) : null;
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = side * dpr; c.height = side * dpr;
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
    const pw = side - M.l - M.r, ph = side - M.t - M.b;
    if (state && legend) {
      const n = state.n1, img = new ImageData(n, n), key: string[] = new Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = displayIndex(state, i, j), r = k >= 0 ? state.res.get(k) : undefined;
        const col = r ? legend.colorOf(r) : [235, 235, 235], o = ((n - 1 - j) * n + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
        key[j * n + i] = col.join();
      }
      const off = new OffscreenCanvas(n, n); off.getContext('2d')!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(off, M.l, M.t, pw, ph);
      const cx = pw / n, cy = ph / n;
      g.beginPath();
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = key[j * n + i];
        if (i + 1 < n && key[j * n + i + 1] !== a) { const x = M.l + (i + 1) * cx, y = M.t + ph - (j + 1) * cy; g.moveTo(x, y); g.lineTo(x, y + cy); }
        if (j + 1 < n && key[(j + 1) * n + i] !== a) { const x = M.l + i * cx, y = M.t + ph - (j + 1) * cy; g.moveTo(x, y); g.lineTo(x + cx, y); }
      }
      g.strokeStyle = 'rgba(17, 24, 39, 0.6)'; g.lineWidth = Math.max(0.6, Math.min(1.2, cx * 0.35)); g.stroke(); g.lineWidth = 1;
    } else if (!prep) {
      g.fillStyle = '#6b7280'; g.font = '13px system-ui'; g.textAlign = 'center';
      g.fillText('no Δv map at this time (not at the section itself,', M.l + pw / 2, M.t + ph / 2 - 8);
      g.fillText('inside the horizon, and the trajectory must still exist there)', M.l + pw / 2, M.t + ph / 2 + 10);
      g.textAlign = 'left';
    }
    g.strokeStyle = '#333'; g.strokeRect(M.l, M.t, pw, ph);
    g.fillStyle = '#222'; g.font = '11px system-ui'; g.textAlign = 'center';
    for (let q = 0; q <= 4; q++) {
      const v = win.p1a + (q / 4) * (win.p1b - win.p1a); g.fillText(v.toFixed(0), M.l + (q / 4) * pw, side - M.b + 14);
      const u = win.p2a + (q / 4) * (win.p2b - win.p2a); g.save(); g.textAlign = 'right'; g.fillText(u.toFixed(axes === 'amag' && magMax < 5 ? 2 : 1), M.l - 4, M.t + ph - (q / 4) * ph + 4); g.restore();
    }
    g.fillText('in-plane direction α [deg]', M.l + pw / 2, side - 4);
    g.save(); g.translate(11, M.t + ph / 2); g.rotate(-Math.PI / 2); g.fillText(axes === 'amag' ? '|Δv| [m/s]' : 'out-of-plane angle β [deg]', 0, 0); g.restore();
    if (cur && cur.u >= win.p1a && cur.u <= win.p1b && cur.v >= win.p2a && cur.v <= win.p2b) {
      const x = M.l + ((cur.u - win.p1a) / (win.p1b - win.p1a)) * pw, y = M.t + ph - ((cur.v - win.p2a) / (win.p2b - win.p2a)) * ph;
      g.fillStyle = '#dc2626'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y + 5); g.lineTo(x - 7, y + 5); g.closePath(); g.fill(); g.stroke(); g.lineWidth = 1;
    }
  });
  const at = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const pw = side - M.l - M.r, ph = side - M.t - M.b;
    return { u: win.p1a + ((x - M.l) / pw) * (win.p1b - win.p1a), v: win.p2a + ((M.t + ph - y) / ph) * (win.p2b - win.p2a), inside: x >= M.l && x <= M.l + pw && y >= M.t && y <= M.t + ph };
  };
  const total = state ? state.n1 * state.n2 : 0;
  const down = useRef(false);
  const setFrom = (q: { u: number; v: number }) => {
    if (!prep) return;
    const a = +q.u.toFixed(2);
    if (axes === 'amag') onSet(+Math.max(0, q.v).toFixed(3), a, fixedBeta);
    else onSet(fixedMag, a, +q.v.toFixed(2));
  };

  return (
    <div className="dvmap">
      <div className="row small dvmap-title"><b>Δv map · burn at {tq.toFixed(3)} d</b>
        <span className="dim">{backward ? 'colour = word before the burn (read backward)' : 'colour = word after the burn'}</span></div>
      <div className="dvmap-main" ref={box}>
        <canvas ref={cv} style={{ width: side, height: side, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={(e) => { const q = at(e); if (!q.inside) return; (e.target as Element).setPointerCapture(e.pointerId); down.current = true; setFrom(q); }}
          onPointerMove={(e) => {
            const q = at(e);
            if (down.current && q.inside) { setFrom(q); return; }
            if (!state || !legend || !q.inside) { setHover(''); return; }
            const n = state.n1, i = Math.round(((q.u - win.p1a) / (win.p1b - win.p1a)) * (n - 1)), j = Math.round(((q.v - win.p2a) / (win.p2b - win.p2a)) * (n - 1));
            const k = displayIndex(state, i, j), r = k >= 0 ? state.res.get(k) : undefined;
            if (!r || r.kind !== 'traj') { setHover(''); return; }
            setHover(`α ${q.u.toFixed(1)}°, ${axes === 'amag' ? `|Δv| ${q.v.toFixed(2)} m/s` : `β ${q.v.toFixed(1)}°`}: ${wordOf(Array.from(r.tokens!), r.status!, coarse)}`);
          }}
          onPointerUp={() => { down.current = false; }} onPointerLeave={() => setHover('')} />
        <div className="hover small">{hover || 'Click or drag on the map to set the burn; the trajectory updates at once.'}</div>
      </div>
      <div className="dvmap-side">
        <div className="dim small">{msg}{state ? ` · ${state.computed} of ${total} points · ${workerCount()} threads` : ''}</div>
        <div className="row small">
          <div className="seg">
            <button className={axes === 'amag' ? 'on' : ''} onClick={() => setAxes('amag')}>(α, |Δv|)</button>
            <button className={axes === 'ab' ? 'on' : ''} onClick={() => setAxes('ab')}>(α, β)</button>
          </div>
          {!backward && <div className="seg">
            <button className={mode === 'classes' ? 'on' : ''} onClick={() => setMode('classes')}>Words after the burn</button>
            <button className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>Your word</button>
          </div>}
        </div>
        <div className="row win small">
          <span>α</span>
          <input type="number" step={5} value={alphaW[0]} onChange={(e) => setAlphaW([+e.target.value, alphaW[1]])} />
          <input type="number" step={5} value={alphaW[1]} onChange={(e) => setAlphaW([alphaW[0], +e.target.value])} />
          {axes === 'amag'
            ? <><span>|Δv| ≤</span><input type="number" step={1} min={0.01} value={magMax} onChange={(e) => setMagMax(Math.max(0.01, +e.target.value))} /><span>β =</span><input type="number" step={1} value={fixedBeta} onChange={(e) => setFixedBeta(+e.target.value)} /></>
            : <><span>β</span><input type="number" step={5} value={betaW[0]} onChange={(e) => setBetaW([+e.target.value, betaW[1]])} /><input type="number" step={5} value={betaW[1]} onChange={(e) => setBetaW([betaW[0], +e.target.value])} /><span>|Δv| =</span><input type="number" step={1} value={fixedMag} onChange={(e) => setFixedMag(+e.target.value)} /></>}
        </div>
        <div className="row small">
          <select value={levels} onChange={(e) => setLevels(+e.target.value)}>
            <option value={2}>49 × 49</option>
            <option value={3}>97 × 97</option>
            <option value={4}>193 × 193</option>
          </select>
          <label>symbols {backward ? 'before' : 'after'} the burn
            <select value={maxSym} onChange={(e) => setMaxSym(+e.target.value)}>
              {[4, 6, 8, 12, 20].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <button className="link small" onClick={() => { setAlphaW([-180, 180]); setMagMax(30); setBetaW([-60, 60]); }}>reset range</button>
        </div>
        <div className="dim small">α: {ALPHA_HINT[frame]}. β: {BETA_HINT[frame]}. {backward ? 'Later burns are applied; the trajectory after this burn is kept.' : `Earlier burns are applied, later ones ignored.${preLen > 1 ? ` The first ${preLen - 1} symbols are fixed before the burn.` : ''}`}</div>
        <div className="legend">
          {legend?.entries.map((e) => {
            const plain = /^(partial|match|no |Other|out|forb|\d+ of )/.test(e.label);
            return (
              <div key={e.key} className={`lg ${highlight === e.key ? 'hl' : ''} ${e.sub ? 'sub' : ''}`} onClick={() => setHighlight((h) => (h === e.key ? null : e.key))}>
                <span className="sw" style={{ background: `rgb(${e.rgb.join(',')})` }} />
                <span className="lt">{plain ? e.label : e.label.split(' ').map((w, q) => (/^[EMX]_/.test(w) ? <Sym key={q} name={w.replace('*', '')} /> : <span key={q}>{w}</span>))}</span>
                <span className="lc">{((100 * e.count) / Math.max(1, total)).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
        {highlight && <button className="link small" onClick={() => setHighlight(null)}>show all again{highlight === OTHER ? '' : ''}</button>}
      </div>
    </div>
  );
}
