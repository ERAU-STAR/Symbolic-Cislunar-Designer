// Builds ModelParams for an epoch on the main thread (loads the static data files).
import { type ModelKind, type ModelParams, TSB } from './models';

const DAY = 86400;
export const JD_TABLE0 = 2458849.5; // 2020-01-01 0h TDB
export const EPOCH_MIN = '2020-01-01T00:00', EPOCH_MAX = '2035-12-31T23:59';

const dataUrl = (f: string) => new URL(`data/${f}`, document.baseURI).toString();
const memo = new Map<string, Promise<unknown>>();
function load<T>(f: string, b64 = false): Promise<T> {
  if (!memo.has(f)) memo.set(f, fetch(dataUrl(f)).then(async (r) => {
    if (!r.ok) throw new Error(`could not load ${f} (${r.status})`);
    if (!b64) return r.json();
    // binary tables are shipped as base64 text so any static host serves them
    const s = atob((await r.text()).trim()), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }));
  return memo.get(f) as Promise<T>;
}

interface Phases { jd0: number; rows: number[][]; lvo: { S0: number[]; P: number } }
interface QPOData { re: number[]; im: number[]; shape: number[]; nuA: number; nu2: number }

/** datetime-local string (read as TDB) -> Julian date */
export function jdOf(s: string): number {
  const ms = Date.parse(s.length === 16 ? s + ':00Z' : s + 'Z');
  return 2440587.5 + ms / 864e5;
}

export interface EpochInfo { f0: number; hrPhase: number; ecc: [number, number]; inc: [number, number]; eccRms: number; incRms: number }

export async function epochInfo(jd: number): Promise<EpochInfo> {
  const P = await load<Phases>('phases.json');
  const [qe, qi] = await Promise.all([load<QPOData>('qpo_ecc.json'), load<QPOData>('qpo_inc.json')]);
  const x = jd - P.jd0;
  const d = Math.max(0, Math.min(P.rows.length - 2, Math.floor(x)));
  const dt = x - d, r = P.rows[d], r1 = P.rows[d + 1];
  let df = r1[0] - r[0];
  if (df < -Math.PI) df += 2 * Math.PI;
  const tH = (dt * DAY) / TSB;
  const wrap = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return {
    f0: wrap(r[0] + df * dt),
    hrPhase: (r[1] + tH / P.lvo.P) % 1,
    ecc: [wrap(r[2] + qe.nuA * tH), wrap(r[3] + qe.nu2 * tH)],
    inc: [wrap(r[4] + qi.nuA * tH), wrap(r[5] + qi.nu2 * tH)],
    eccRms: r[6], incRms: r[7],
  };
}

/** QPO Moon-Earth state table on t = -tEnd..tEnd (Hill units), step h; row q at t = -tEnd' + q h */
function qpoTable(q: QPOData, thA: number, th2: number, tEnd: number, h: number) {
  const [N1, NS, N2] = q.shape, K1 = (N1 - 1) / 2, K2 = (N2 - 1) / 2;
  const m = Math.ceil(tEnd / h) + 1, tg0 = -m * h;
  const n = 2 * m + 2;
  const R = new Float64Array(3 * n), V = new Float64Array(3 * n);
  const c1 = new Float64Array(N1), s1 = new Float64Array(N1), c2 = new Float64Array(N2), s2 = new Float64Array(N2);
  for (let q0 = 0; q0 < n; q0++) {
    const t = tg0 + q0 * h, a = thA + q.nuA * t, b = th2 + q.nu2 * t;
    for (let i = 0; i < N1; i++) { c1[i] = Math.cos((i - K1) * a); s1[i] = Math.sin((i - K1) * a); }
    for (let j = 0; j < N2; j++) { c2[j] = Math.cos((j - K2) * b); s2[j] = Math.sin((j - K2) * b); }
    for (let s = 0; s < NS; s++) {
      let acc = 0;
      for (let i = 0; i < N1; i++) {
        const base = (i * NS + s) * N2;
        for (let j = 0; j < N2; j++) {
          // Re[(re + i im) * (cos + i sin)] with cos/sin of (k1 a + k2 b)
          const cc = c1[i] * c2[j] - s1[i] * s2[j], ss = s1[i] * c2[j] + c1[i] * s2[j];
          acc += q.re[base + j] * cc - q.im[base + j] * ss;
        }
      }
      if (s < 3) R[3 * q0 + s] = acc; else V[3 * q0 + s - 3] = acc;
    }
  }
  return { R, V, tg0 };
}

/** LVO (Hill variation orbit) table over one period, fixed-step RK4 */
function lvoTable(S0: number[], P: number) {
  const n = Math.round(P / 2e-4), h = P / n, sub = 10, hs = h / sub;
  const f = (y: number[]) => {
    const r3 = (y[0] ** 2 + y[1] ** 2 + y[2] ** 2) ** 1.5;
    return [y[3], y[4], y[5], 2 * y[4] + 3 * y[0] - y[0] / r3, -2 * y[3] - y[1] / r3, -y[2] - y[2] / r3];
  };
  const R = new Float64Array(3 * (n + 1)), V = new Float64Array(3 * (n + 1));
  let y = S0.slice();
  for (let q = 0; q <= n; q++) {
    for (let i = 0; i < 3; i++) { R[3 * q + i] = y[i]; V[3 * q + i] = y[3 + i]; }
    for (let k = 0; k < sub; k++) {
      const k1 = f(y), k2 = f(y.map((v, i) => v + 0.5 * hs * k1[i])), k3 = f(y.map((v, i) => v + 0.5 * hs * k2[i])), k4 = f(y.map((v, i) => v + hs * k3[i]));
      y = y.map((v, i) => v + (hs / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
  }
  return { R, V, h };
}

/** hand-set phase angles (radians; hrPhase as a fraction of the variation-orbit period), replacing the epoch's */
export interface PhaseOverride { f0?: number; hrPhase?: number; ecc?: [number, number]; inc?: [number, number] }
export const ovKey = (ov?: PhaseOverride | null) => (ov ? JSON.stringify(ov) : '');

export async function buildModel(kind: ModelKind, jd: number, horizonDays: number, ov?: PhaseOverride | null): Promise<ModelParams> {
  if (kind === 'cr3bp') return { kind };
  if (kind === 'hfem') {
    const jdA = jd - horizonDays - 2, jdB = jd + horizonDays + 2;
    return buildHfemRange(jd, jdA, jdB);
  }
  const E0 = await epochInfo(jd);
  const E = ov ? { ...E0, ...ov } : E0;
  if (kind === 'er3bp') return { kind, f0: E.f0 };
  const tEndH = ((horizonDays + 2) * DAY) / TSB;
  if (kind === 'hr4bp') {
    const P = (await load<Phases>('phases.json')).lvo;
    const { R, V, h } = lvoTable(P.S0, P.P);
    return { kind: 'hill', label: kind, h, tg0: 0, R, V, period: P.P, offset: E.hrPhase * P.P };
  }
  if (kind === 'qhr4bp_ecc' || kind === 'qhr4bp_inc') {
    const q = await load<QPOData>(kind === 'qhr4bp_ecc' ? 'qpo_ecc.json' : 'qpo_inc.json');
    const [a, b] = kind === 'qhr4bp_ecc' ? E.ecc : E.inc;
    const h = 2e-4, { R, V, tg0 } = qpoTable(q, a, b, tEndH, h);
    return { kind: 'hill', label: kind, h, tg0, R, V, period: 0, offset: 0 };
  }
  throw new Error('unknown model');
}

// ---------------------------------------------------------------- ephemeris tables
const YEAR_FILES = new Set([2011, 2012, ...Array.from({ length: 16 }, (_, k) => 2020 + k)]);
const jdOfYear = (y: number) => Date.UTC(y, 0, 1) / 864e5 + 2440587.5;
const yearOf = (jd: number) => new Date((jd - 2440587.5) * 864e5).getUTCFullYear();
/** hourly geocentric Moon r, v and Sun r, v [km, km/s] from jdA to jdB (TDB), stitched from the year files
 *  (each file starts 130 d before Jan 1 and runs 626 d). Rows: [rM vM rS vS]. */
export async function ephemRange(jdA: number, jdB: number): Promise<{ jdStart: number; n: number; tab: Float64Array }> {
  const jdStart = Math.floor(jdA * 24) / 24, n = Math.ceil((jdB - jdStart) * 24) + 2;
  const need = new Set<number>();
  for (let y = yearOf(jdStart) - 1; y <= yearOf(jdB) + 1; y++) if (YEAR_FILES.has(y)) need.add(y);
  const files = new Map<number, Float32Array>();
  await Promise.all([...need].map(async (y) => { try { files.set(y, new Float32Array(await load<ArrayBuffer>(`ephem_${y}.b64.txt`, true))); } catch { /* missing year */ } }));
  const tab = new Float64Array(12 * n);
  for (let q = 0; q < n; q++) {
    const jd = jdStart + q / 24, y = yearOf(jd);
    let done = false;
    for (const yy of [y, y - 1, y + 1]) {
      const f = files.get(yy); if (!f) continue;
      const k = Math.round((jd - (jdOfYear(yy) - 130)) * 24);
      if (k < 0 || k >= f.length / 12) continue;
      for (let i = 0; i < 12; i++) tab[12 * q + i] = f[12 * k + i];
      done = true; break;
    }
    if (!done) throw new Error(`no ephemeris for ${new Date((jd - 2440587.5) * 864e5).toISOString().slice(0, 10)} (tables: 2011-2012, 2020-2035)`);
  }
  return { jdStart, n, tab };
}
/** HFEM over an arbitrary span (model time 0 at jdEpoch) */
export async function buildHfemRange(jdEpoch: number, jdA: number, jdB: number): Promise<ModelParams> {
  const E = await ephemRange(Math.min(jdA, jdEpoch - 1), Math.max(jdB, jdEpoch + 1));
  return { kind: 'hfem', h: 3600, t0: (jdEpoch - E.jdStart) * DAY, tab: E.tab };
}

/** epoch in the phase table (2020-2035) whose phase angles are closest to the target ones */
export async function closestEpoch(kind: ModelKind, target: { f0?: number; hrPhase?: number; ecc?: [number, number]; inc?: [number, number] }) {
  const P = await load<Phases>('phases.json');
  const ang = (E: EpochInfo): number[] => kind === 'er3bp' ? [E.f0] : kind === 'hr4bp' ? [E.hrPhase * 2 * Math.PI] : kind === 'qhr4bp_ecc' ? E.ecc : kind === 'qhr4bp_inc' ? E.inc : [];
  const tgt = kind === 'er3bp' ? [target.f0 ?? 0] : kind === 'hr4bp' ? [(target.hrPhase ?? 0) * 2 * Math.PI] : kind === 'qhr4bp_ecc' ? target.ecc ?? [0, 0] : kind === 'qhr4bp_inc' ? target.inc ?? [0, 0] : [];
  const dist = (a: number[]) => Math.sqrt(a.reduce((s, v, i) => { const d = Math.atan2(Math.sin(v - tgt[i]), Math.cos(v - tgt[i])); return s + d * d; }, 0));
  let best = { jd: P.jd0, d: Infinity };
  for (let k = 0; k < P.rows.length - 1; k++) {
    const jd = P.jd0 + k, d = dist(ang(await epochInfo(jd)));
    if (d < best.d) best = { jd, d };
  }
  // refine hourly within +-1 day
  for (let h = -24; h <= 24; h++) {
    const jd = best.jd + h / 24, d = dist(ang(await epochInfo(jd)));
    if (d < best.d) best = { jd, d };
  }
  return { jd: best.jd, errDeg: (best.d * 180) / Math.PI, angles: ang(await epochInfo(best.jd)).map((v) => (v * 180) / Math.PI) };
}

export const MODEL_LABEL: Record<ModelKind, string> = {
  cr3bp: 'CR3BP', er3bp: 'ER3BP', hr4bp: 'HR4BP', qhr4bp_ecc: 'QHR4BP (eccentricity)', qhr4bp_inc: 'QHR4BP (inclination)', hfem: 'HFEM (DE421 ephemeris)',
};
