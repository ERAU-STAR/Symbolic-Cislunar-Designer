// Real missions: CCSDS OEM or JPL Horizons vector tables -> geocentric states (TDB),
// pulsating Earth-Moon states in the app's section convention, the symbolic word,
// boundary crossings (usable as sections) and maneuvers found from velocity jumps.
import { MU, A_STAR, B_STAR, X_MOON, X_EARTH, X_G, L4, twoU } from './constants';
import { classify } from './partition';
import { edgePieces, type Piece } from './boundary';
import { ephemRange, buildHfemRange } from './modelSetup';
import { makeDyn, TSTAR_S } from './models';
import { propagate } from './cr3bp';

type V3 = [number, number, number];
const D2R = Math.PI / 180, DAY = 86400;

export interface MissionRaw { name: string; source: string; frame: string; center: 'EARTH' | 'MOON'; jd: number[]; X: number[][] } // jd TDB, X km, km/s
export interface Crossing { jd: number; src: number; tgt: number; x: number[]; C: number; piece: Piece | null; s: number; psi2: number; z: number; psi3: number }
export interface MissionBurn { jd: number; jd0: number; jd1: number; dvIn: V3; mag: number; vnb: V3; alpha: number; beta: number; rMoon: number; rEarth: number }
export interface Mission extends MissionRaw {
  puls: number[][]; // [x y z x' y' z'] instantaneous pulsating (barycentric), per sample
  C: number[]; // 2U - v^2 per sample
  ell: number[]; // Earth-Moon distance [km] per sample
  tokens: number[]; tokJd: number[];
  crossings: Crossing[];
  burns: MissionBurn[];
  residual?: { jd: number; dv: number }[];
}

// ---------------------------------------------------------------- time
// TAI - UTC (s) from these UTC dates on
const LEAP: [number, number][] = [[Date.UTC(1972, 0, 1), 10], [Date.UTC(1972, 6, 1), 11], [Date.UTC(1973, 0, 1), 12], [Date.UTC(1974, 0, 1), 13], [Date.UTC(1975, 0, 1), 14], [Date.UTC(1976, 0, 1), 15], [Date.UTC(1977, 0, 1), 16], [Date.UTC(1978, 0, 1), 17], [Date.UTC(1979, 0, 1), 18], [Date.UTC(1980, 0, 1), 19], [Date.UTC(1981, 6, 1), 20], [Date.UTC(1982, 6, 1), 21], [Date.UTC(1983, 6, 1), 22], [Date.UTC(1985, 6, 1), 23], [Date.UTC(1988, 0, 1), 24], [Date.UTC(1990, 0, 1), 25], [Date.UTC(1991, 0, 1), 26], [Date.UTC(1992, 6, 1), 27], [Date.UTC(1993, 6, 1), 28], [Date.UTC(1994, 6, 1), 29], [Date.UTC(1996, 0, 1), 30], [Date.UTC(1997, 6, 1), 31], [Date.UTC(1999, 0, 1), 32], [Date.UTC(2006, 0, 1), 33], [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2015, 6, 1), 36], [Date.UTC(2017, 0, 1), 37]];
const taiUtc = (ms: number) => { let v = 10; for (const [t, s] of LEAP) if (ms >= t) v = s; return v; };
const jdOfMs = (ms: number) => 2440587.5 + ms / 864e5;
/** ISO time in the given scale -> JD TDB */
export function isoToTdb(iso: string, scale: string): number {
  const s = iso.trim().replace(/Z$/, '');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s) ?? /^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) throw new Error(`bad time ${iso}`);
  let ms: number;
  if (m.length === 7) ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + parseFloat(m[6]) * 1000;
  else ms = Date.UTC(+m[1], 0, 1, +m[3], +m[4]) + (+m[2] - 1) * 864e5 + parseFloat(m[5]) * 1000; // day-of-year form
  let tt: number;
  const sc = scale.toUpperCase();
  if (sc === 'UTC') tt = ms + (taiUtc(ms) + 32.184) * 1000;
  else if (sc === 'TAI') tt = ms + 32.184 * 1000;
  else if (sc === 'GPS') tt = ms + (19 + 32.184) * 1000;
  else tt = ms; // TT or TDB
  const jdTT = jdOfMs(tt);
  if (sc === 'TDB') return jdTT;
  const g = (357.53 + 0.98560028 * (jdTT - 2451545.0)) * D2R;
  return jdTT + (0.001657 * Math.sin(g + 0.01671 * Math.sin(g))) / DAY;
}
export function tdbToIso(jd: number, withSeconds = true) {
  const d = new Date((jd - 2440587.5) * 864e5);
  return d.toISOString().slice(0, withSeconds ? 19 : 16);
}

// ---------------------------------------------------------------- parsers
export function parseOEM(text: string, fallbackName = 'mission'): MissionRaw {
  let name = fallbackName, center = 'EARTH', frame = 'EME2000', scale = 'UTC', inData = false, inCov = false;
  const jd: number[] = [], X: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('COMMENT')) continue;
    const kv = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (kv) {
      const [, k, v] = kv;
      if (k === 'OBJECT_NAME') name = v.trim();
      else if (k === 'CENTER_NAME') center = v.trim().toUpperCase();
      else if (k === 'REF_FRAME') frame = v.trim();
      else if (k === 'TIME_SYSTEM') scale = v.trim();
      continue;
    }
    if (line === 'META_START') { inData = false; continue; }
    if (line === 'META_STOP') { inData = true; continue; }
    if (line === 'COVARIANCE_START') { inCov = true; continue; }
    if (line === 'COVARIANCE_STOP') { inCov = false; continue; }
    if (!inData || inCov) continue;
    const p = line.split(/\s+/);
    if (p.length < 7 || !/^\d{4}-/.test(p[0])) continue;
    const v = p.slice(1, 7).map(Number);
    if (v.some((x) => !Number.isFinite(x))) continue;
    const t = isoToTdb(p[0], scale);
    if (jd.length && t <= jd[jd.length - 1]) { // repeated epoch at a segment boundary: keep the later one
      if (t === jd[jd.length - 1]) { X[X.length - 1] = v; }
      continue;
    }
    jd.push(t); X.push(v);
  }
  if (!jd.length) throw new Error('no state lines found (expected CCSDS OEM: "time x y z vx vy vz")');
  if (center !== 'EARTH' && center !== 'MOON') throw new Error(`center ${center} is not supported (EARTH or MOON)`);
  return { name, source: 'OEM', frame, center: center as 'EARTH' | 'MOON', jd, X };
}

export function parseHorizons(text: string, fallbackName = 'mission'): MissionRaw {
  const name = /Target body name:\s*(.+?)\s*(\(|\{|$)/m.exec(text)?.[1]?.trim() ?? fallbackName;
  const cb = /Center body name:\s*(\w+)/m.exec(text)?.[1]?.toUpperCase() ?? 'EARTH';
  const frame = /Reference frame\s*:\s*(\S+)/m.exec(text)?.[1] ?? 'ICRF';
  const units = /Output units\s*:\s*(\S+)/m.exec(text)?.[1] ?? 'KM-S';
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0 || b < 0) throw new Error('no $$SOE / $$EOE block (expected a Horizons vector table)');
  const body = text.slice(a + 5, b);
  const jd: number[] = [], X: number[][] = [];
  const num = (s: string) => parseFloat(s.replace(/D/i, 'E'));
  if (body.includes(',')) { // CSV form: JD, cal, X, Y, Z, VX, VY, VZ, ...
    for (const line of body.split(/\r?\n/)) {
      const p = line.split(',').map((x) => x.trim());
      if (p.length < 8) continue;
      jd.push(num(p[0])); X.push(p.slice(2, 8).map(num));
    }
  } else {
    const re = /^\s*([\d.]+)\s*=.*?\n\s*X\s*=\s*(\S+)\s*Y\s*=\s*(\S+)\s*Z\s*=\s*(\S+)\s*\n\s*VX\s*=\s*(\S+)\s*VY\s*=\s*(\S+)\s*VZ\s*=\s*(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) { jd.push(num(m[1])); X.push(m.slice(2, 8).map(num)); }
  }
  if (!jd.length) throw new Error('no states found in the Horizons table');
  const scale = units.toUpperCase().startsWith('AU') ? 149597870.7 : 1, tsc = units.toUpperCase().endsWith('-D') ? 1 / DAY : 1;
  if (scale !== 1 || tsc !== 1) X.forEach((v) => { for (let i = 0; i < 3; i++) v[i] *= scale; for (let i = 3; i < 6; i++) v[i] *= scale * tsc; });
  const center = cb.startsWith('MOON') ? 'MOON' : cb.startsWith('EARTH') ? 'EARTH' : (() => { throw new Error(`center ${cb} is not supported (Earth or Moon)`); })();
  return { name, source: 'Horizons', frame, center, jd, X };
}

export function parseMission(text: string, fallbackName = 'mission'): MissionRaw {
  return text.includes('$$SOE') ? parseHorizons(text, fallbackName) : parseOEM(text, fallbackName);
}

// ---------------------------------------------------------------- conversion
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.sqrt(dot(a, a));

/** Moon state from an hourly table by cubic Hermite */
function moonFrom(E: { jdStart: number; n: number; tab: Float64Array }, jd: number) {
  const s = (jd - E.jdStart) * 24, k = Math.max(0, Math.min(E.n - 2, Math.floor(s))), u = s - k, h = 3600;
  const o0 = 12 * k, o1 = o0 + 12, r = [0, 0, 0], v = [0, 0, 0];
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
  for (let i = 0; i < 3; i++) {
    const a = E.tab[o0 + i], da = E.tab[o0 + 3 + i], b = E.tab[o1 + i], db = E.tab[o1 + 3 + i];
    r[i] = h00 * a + h10 * h * da + h01 * b + h11 * h * db;
    v[i] = d00 * a + d10 * da + d01 * b + d11 * db;
  }
  return { r, v };
}

/** geocentric inertial state -> pulsating (barycentric, instantaneous units: rho' = d rho / d tau') */
export function toPulsating(r: number[], v: number[], rM: number[], vM: number[]) {
  const l = norm(rM), xh = rM.map((c) => c / l), hv = cross(rM, vM), hn = norm(hv), zh = hv.map((c) => c / hn), yh = cross(zh, xh);
  const w = hn / (l * l), ld = dot(rM, vM) / l;
  const rr = [dot(xh, r), dot(yh, r), dot(zh, r)], vv = [dot(xh, v), dot(yh, v), dot(zh, v)];
  const vrot = [vv[0] + w * rr[1], vv[1] - w * rr[0], vv[2]];
  const rho = rr.map((c) => c / l);
  const drho = [0, 1, 2].map((i) => (vrot[i] - ld * rho[i]) / (l * w));
  return { x: [rho[0] - MU, rho[1], rho[2], drho[0], drho[1], drho[2]], l };
}

/** boundary coordinate s of a point on a shape (inverse of shape.pt) */
function sOn(id: string, x: number, y: number): number {
  if (id === 'ellipse') { let a = Math.atan2(y / B_STAR, (x - X_MOON) / A_STAR) / D2R; if (a < 0) a += 360; return a; }
  if (id === 'circle') { let a = Math.atan2(y, x - X_G) / D2R; if (a < 0) a += 360; return a; }
  if (id.startsWith('x=')) return y;
  if (id === 'y=0') return x;
  if (id.startsWith('ray')) return Math.hypot(x - X_EARTH, y);
  return NaN;
}
const ang = (L4[1] / (L4[0] - X_EARTH));
void ang;

function pieceAt(src: number, tgt: number, C: number, x: number, y: number): { piece: Piece | null; s: number } {
  let best: { piece: Piece; s: number; d: number } | null = null;
  for (const pc of edgePieces(src, tgt, C)) {
    let s = sOn(pc.shape.id, x, y);
    if (!Number.isFinite(s)) continue;
    const [px, py] = pc.shape.pt(s), d = Math.hypot(px - x, py - y);
    if (d > 2e-3) continue;
    if (pc.shape.periodic) { while (s < pc.s0) s += 360; while (s > pc.s1 && s - 360 >= pc.s0) s -= 360; }
    const inside = s >= pc.s0 - 0.5 && s <= pc.s1 + 0.5;
    if (inside && (!best || d < best.d)) best = { piece: pc, s, d };
  }
  return best ? { piece: best.piece, s: best.s } : { piece: null, s: NaN };
}

export interface ProcessOpts { burnThreshold?: number; minEarthKm?: number; onProgress?: (msg: string) => void }

/** full processing: conversion, word, crossings, maneuvers */
export async function processMission(raw: MissionRaw, o: ProcessOpts = {}): Promise<Mission> {
  const n = raw.jd.length, jd0 = raw.jd[0], jd1 = raw.jd[n - 1];
  o.onProgress?.(`${n} states, loading the Moon ephemeris…`);
  const E = await ephemRange(jd0 - 1, jd1 + 1);
  // geocentric states
  const X = raw.X.map((s, k) => {
    if (raw.center === 'EARTH') return s.slice();
    const m = moonFrom(E, raw.jd[k]);
    return [s[0] + m.r[0], s[1] + m.r[1], s[2] + m.r[2], s[3] + m.v[0], s[4] + m.v[1], s[5] + m.v[2]];
  });
  const puls: number[][] = [], C: number[] = [], ell: number[] = [];
  const pulsAt = (jd: number, s: number[]) => { const m = moonFrom(E, jd); return toPulsating(s.slice(0, 3), s.slice(3, 6), m.r, m.v); };
  for (let k = 0; k < n; k++) {
    const p = pulsAt(raw.jd[k], X[k]);
    puls.push(p.x); ell.push(p.l);
    C.push(twoU(p.x[0], p.x[1], p.x[2]) - (p.x[3] ** 2 + p.x[4] ** 2 + p.x[5] ** 2));
  }
  // ---- word and crossings (Hermite interpolation between samples, bisection to the boundary)
  o.onProgress?.('finding boundary crossings…');
  const herm = (k: number, u: number) => {
    const h = (raw.jd[k + 1] - raw.jd[k]) * DAY, a = X[k], b = X[k + 1], out = [0, 0, 0, 0, 0, 0];
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
    for (let i = 0; i < 3; i++) {
      out[i] = h00 * a[i] + h10 * h * a[3 + i] + h01 * b[i] + h11 * h * b[3 + i];
      out[3 + i] = d00 * a[i] + d10 * a[3 + i] + d01 * b[i] + d11 * b[3 + i];
    }
    return out;
  };
  const regAt = (k: number, u: number) => {
    const jd = raw.jd[k] + u * (raw.jd[k + 1] - raw.jd[k]), s = herm(k, u), p = pulsAt(jd, s), c = twoU(p.x[0], p.x[1], p.x[2]) - (p.x[3] ** 2 + p.x[4] ** 2 + p.x[5] ** 2);
    return { id: classify(p.x[0], p.x[1], c), x: p.x, C: c, jd };
  };
  const tokens: number[] = [], tokJd: number[] = [], crossings: Crossing[] = [];
  let cur = classify(puls[0][0], puls[0][1], C[0]);
  tokens.push(cur); tokJd.push(jd0);
  for (let k = 0; k + 1 < n; k++) {
    const nxt = classify(puls[k + 1][0], puls[k + 1][1], C[k + 1]);
    // sub-sample the interval when the end regions differ or the interval is long (short visits)
    const span = raw.jd[k + 1] - raw.jd[k];
    if (nxt === cur && span < 0.05) continue;
    const m = nxt === cur ? Math.max(2, Math.ceil(span / 0.02)) : Math.max(8, Math.ceil(span / 0.01));
    let ua = 0, ra = cur;
    for (let q = 1; q <= m; q++) {
      const ub = q / m, rb = q === m ? { id: nxt } : regAt(k, ub);
      if (rb.id !== ra) {
        let lo = ua, hi = ub; // bisection on the region change
        for (let it = 0; it < 40; it++) { const mid = 0.5 * (lo + hi); if (regAt(k, mid).id === ra) lo = mid; else hi = mid; }
        const at = regAt(k, hi);
        const src = ra, tgt = at.id;
        const { piece, s } = pieceAt(src, tgt, at.C, at.x[0], at.x[1]);
        const sp = Math.hypot(at.x[3], at.x[4], at.x[5]);
        crossings.push({ jd: at.jd, src, tgt, x: at.x, C: at.C, piece, s, psi2: Math.atan2(at.x[4], at.x[3]) / D2R, z: at.x[2], psi3: Math.asin(at.x[5] / sp) / D2R });
        tokens.push(tgt); tokJd.push(at.jd);
        ra = tgt;
      }
      ua = ub;
    }
    cur = nxt;
  }
  // ---- maneuvers: propagate HFEM over every sample interval and compare with the next sample
  const thr = o.burnThreshold ?? 1, minE = o.minEarthKm ?? 7000;
  o.onProgress?.('looking for maneuvers (HFEM propagation between samples)…');
  const dyn = makeDyn(await buildHfemRange(jd0, jd0 - 1, jd1 + 1));
  const tau = (jd: number) => ((jd - jd0) * DAY) / TSTAR_S;
  const prop = (k0: number, jdT: number) => {
    const t0 = tau(raw.jd[k0]), t1 = tau(jdT);
    return propagate([], { y0: X[k0], t0, tEnd: Math.abs(t1 - t0), dir: t1 >= t0 ? 1 : -1, C: 3, dyn }).yEnd!;
  };
  const propFrom = (y: number[], jdA: number, jdT: number) => {
    const t0 = tau(jdA), t1 = tau(jdT);
    return propagate([], { y0: y, t0, tEnd: Math.abs(t1 - t0), dir: t1 >= t0 ? 1 : -1, C: 3, dyn }).yEnd!;
  };
  const res: { jd: number; dv: number }[] = [];
  const flag: boolean[] = [];
  for (let k = 0; k + 1 < n; k++) {
    if (k % 500 === 0) { o.onProgress?.(`looking for maneuvers: ${k} of ${n - 1} intervals`); await new Promise((r) => setTimeout(r, 0)); }
    // close to the Earth only densely sampled arcs can be checked (hourly samples miss the perigee pass)
    const rMin = Math.min(norm(X[k].slice(0, 3)), norm(X[k + 1].slice(0, 3))), dtS = (raw.jd[k + 1] - raw.jd[k]) * DAY;
    const near = rMin < minE || (dtS > 600 && rMin < 30000);
    const y = prop(k, raw.jd[k + 1]);
    const dv = 1000 * Math.hypot(y[3] - X[k + 1][3], y[4] - X[k + 1][4], y[5] - X[k + 1][5]);
    res.push({ jd: 0.5 * (raw.jd[k] + raw.jd[k + 1]), dv: near ? 0 : dv });
  }
  // a maneuver is a residual above the threshold AND well above its neighbours: close to the Earth (J2) or in
  // low lunar orbit (lunar gravity field) the point-mass HFEM leaves a smooth, larger background residual
  const W = 25;
  for (let k = 0; k < res.length; k++) {
    const nb: number[] = [];
    for (let q = Math.max(0, k - W); q <= Math.min(res.length - 1, k + W); q++) if (Math.abs(q - k) > 2) nb.push(res[q].dv);
    nb.sort((a, b) => a - b);
    const med = nb.length ? nb[nb.length >> 1] : 0;
    flag.push(res[k].dv > thr && res[k].dv > 8 * med);
  }
  const burns: MissionBurn[] = [];
  for (let k = 0; k < flag.length; k++) {
    if (!flag[k]) continue;
    let e = k;
    while (e + 1 < flag.length && (flag[e + 1] || (e + 2 < flag.length && flag[e + 2] && raw.jd[e + 2] - raw.jd[e] < 0.02))) e++;
    // equivalent impulse at the middle of the span: forward from the first sample, backward from the last
    const a = k, b = e + 1, jm = 0.5 * (raw.jd[a] + raw.jd[b]);
    const yf = prop(a, jm), yb = propFrom(X[b], raw.jd[b], jm);
    const dvIn: V3 = [yb[3] - yf[3], yb[4] - yf[4], yb[5] - yf[5]];
    const m = moonFrom(E, jm), rr = [yf[0] - m.r[0], yf[1] - m.r[1], yf[2] - m.r[2]], vv = [yf[3] - m.v[0], yf[4] - m.v[1], yf[5] - m.v[2]];
    const V = vv.map((c) => c / norm(vv)), N0 = cross(rr, vv), N = N0.map((c) => c / norm(N0)), B = cross(V, N);
    const comp: V3 = [1000 * dot(V, dvIn), 1000 * dot(N, dvIn), 1000 * dot(B, dvIn)];
    const mag = Math.hypot(...comp);
    burns.push({ jd: jm, jd0: raw.jd[a], jd1: raw.jd[b], dvIn, mag, vnb: comp, alpha: Math.atan2(comp[2], comp[0]) / D2R, beta: mag > 0 ? Math.asin(comp[1] / mag) / D2R : 0, rMoon: norm(rr), rEarth: norm(yf.slice(0, 3)) });
    k = e;
  }
  o.onProgress?.('done');
  return { ...raw, X, puls, C, ell, tokens, tokJd, crossings, burns, residual: res };
}

/** built-in missions shipped with the app (public/data/missions); others can be loaded from a file */
export const BUILTIN = [
  { id: 'artemis1', name: 'Artemis I (Orion EM1)', file: 'Artemis_I_OEM.txt', note: 'NASA/JSC OEM, UTC, 2022-11-16 .. 12-11' },
  { id: 'artemis2', name: 'Artemis II (Orion EM2)', file: 'Artemis_II_OEM.txt', note: 'NASA/JSC OEM, UTC, 2026-04-02 .. 04-10' },
] as const;

/** mission geocentric state at any time inside the span (cubic Hermite between samples) */
export function missionStateAt(M: { jd: number[]; X: number[][] }, jd: number): number[] | null {
  const n = M.jd.length;
  if (jd < M.jd[0] || jd > M.jd[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (M.jd[m] <= jd) lo = m; else hi = m; }
  const h = (M.jd[hi] - M.jd[lo]) * DAY, u = h > 0 ? ((jd - M.jd[lo]) * DAY) / h : 0, a = M.X[lo], b = M.X[hi], out = [0, 0, 0, 0, 0, 0];
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
  for (let i = 0; i < 3; i++) {
    out[i] = h00 * a[i] + h10 * h * a[3 + i] + h01 * b[i] + h11 * h * b[3 + i];
    out[3 + i] = h > 0 ? d00 * a[i] + d10 * a[3 + i] + d01 * b[i] + d11 * b[3 + i] : a[3 + i];
  }
  return out;
}
