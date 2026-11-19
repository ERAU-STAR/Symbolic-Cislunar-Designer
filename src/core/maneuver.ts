// Impulsive maneuvers for every model. Everything goes through the model's inertial
// snapshot (Earth-centred, epoch Earth-Moon plane, 384 400 km units), so one code path
// serves CR3BP, ER3BP, HR4BP, QHR4BP and HFEM:
//   inertial position I(t, x) depends on the model position x only, so an impulse
//   dv (inertial) changes the model velocity by  A^-1 dv  with  A = dI/dx  (3 x 3).
// Frames for the dv components: VNB about the Moon or the Earth (inertial velocity
// relative to that body), or the rotating Earth-Moon axes.
import { propagate, type PropResult } from './cr3bp';
import { TSTAR_S, type Dyn } from './models';
import { TSTAR_DAYS } from './constants';
import { classify } from './partition';
import { ID } from './symbols';

type V3 = [number, number, number];
export type DvFrame = 'vnb-moon' | 'vnb-earth' | 'rot';
export const FRAME_LABEL: Record<DvFrame, string> = {
  'vnb-moon': 'VNB about the Moon',
  'vnb-earth': 'VNB about the Earth',
  rot: 'rotating x, y, z',
};
export const COMP_LABEL: Record<DvFrame, [string, string, string]> = {
  'vnb-moon': ['V', 'N', 'B'],
  'vnb-earth': ['V', 'N', 'B'],
  rot: ['x', 'y', 'z'],
};
/** A burn is given as magnitude + direction:
 *  alpha = in-plane angle [deg] (VNB: from V towards B, i.e. 0 prograde, 90 outward, 180 retrograde;
 *          rotating: from +x towards +y), beta = out-of-plane angle [deg] (VNB: towards N = orbit normal;
 *          rotating: towards +z). */
export type BurnSide = 'future' | 'past';
export interface Burn {
  id: number; tDays: number; frame: DvFrame; mag: number; alpha: number; beta: number; on: boolean; note?: string; // mag [m/s]
  /** future: the state before the burn is kept and the trajectory after it changes; past: the state after the burn
   *  is kept and the trajectory before it changes (state before = state after - dv, propagated backward) */
  side?: BurnSide;
  /** still being placed (its time follows the time slider) until "Done" */
  draft?: boolean;
}
/** default side: a burn after the section changes the future, one before it changes the past */
export const sideOf = (b: Burn): BurnSide => b.side ?? (b.tDays < 0 ? 'past' : 'future');
export const ALPHA_HINT: Record<DvFrame, string> = {
  'vnb-moon': '0° = prograde (V), 90° = outward (B), 180° = retrograde',
  'vnb-earth': '0° = prograde (V), 90° = outward (B), 180° = retrograde',
  rot: 'from +x towards +y (rotating frame)',
};
export const BETA_HINT: Record<DvFrame, string> = {
  'vnb-moon': '+ = along N (orbit normal about the Moon)',
  'vnb-earth': '+ = along N (orbit normal about the Earth)',
  rot: '+ = towards +z',
};
const D2R = Math.PI / 180;
/** components [m/s] in the frame-axes order (VNB: V, N, B; rotating: x, y, z) */
export function dvComponents(frame: DvFrame, mag: number, alpha: number, beta: number): V3 {
  const ca = Math.cos(alpha * D2R), sa = Math.sin(alpha * D2R), cb = Math.cos(beta * D2R), sb = Math.sin(beta * D2R);
  return frame === 'rot' ? [mag * cb * ca, mag * cb * sa, mag * sb] : [mag * cb * ca, mag * sb, mag * cb * sa];
}
export const dvOf = (b: Burn) => dvComponents(b.frame, b.mag, b.alpha, b.beta);

const LU = 384400; // inertial display unit [km]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = nrm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** seconds per model time unit */
export const secPerT = (dyn: Dyn) => TSTAR_S / dyn.tPerTau;

/** A = dI/dx (inertial display position w.r.t. the model position), columns j = 0..2 */
function posJacobian(dyn: Dyn, t: number, y: ArrayLike<number>): number[][] {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const sc = Math.max(1, Math.hypot(y[0], y[1], y[2]));
  for (let j = 0; j < 3; j++) {
    const d = 1e-6 * sc, yp = Float64Array.from(y as number[]), ym = Float64Array.from(y as number[]);
    yp[j] += d; ym[j] -= d;
    const a = dyn.inertial(t, yp).sc, b = dyn.inertial(t, ym).sc;
    for (let i = 0; i < 3; i++) A[i][j] = (a[i] - b[i]) / (2 * d);
  }
  return A;
}
function solve3(A: number[][], b: V3): V3 {
  const [a, c, e] = A, det = a[0] * (c[1] * e[2] - c[2] * e[1]) - a[1] * (c[0] * e[2] - c[2] * e[0]) + a[2] * (c[0] * e[1] - c[1] * e[0]);
  const col = (M: number[][], j: number, v: V3) => M.map((r, i) => r.map((x, k) => (k === j ? v[i] : x)));
  const d = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  return [d(col(A, 0, b)) / det, d(col(A, 1, b)) / det, d(col(A, 2, b)) / det];
}

/** inertial positions [LU] and velocities [km/s] of the spacecraft and the Moon (Earth at the origin) */
export function inertialState(dyn: Dyn, t: number, y: ArrayLike<number>) {
  const N = dyn.n, f = new Float64Array(N), yy = Float64Array.from(y as number[]);
  dyn.rhs(t, yy, f);
  const h = 1e-4 * dyn.tPerTau; // ~ 38 s of model time
  const yp = yy.map((v, i) => v + h * f[i]), ym = yy.map((v, i) => v - h * f[i]);
  const P = dyn.inertial(t + h, yp), M = dyn.inertial(t - h, ym), I0 = dyn.inertial(t, yy);
  const s = LU / (2 * h * secPerT(dyn)); // [LU / model time] -> [km/s]
  return {
    r: I0.sc, rm: I0.moon,
    v: [(P.sc[0] - M.sc[0]) * s, (P.sc[1] - M.sc[1]) * s, (P.sc[2] - M.sc[2]) * s] as V3,
    vm: [(P.moon[0] - M.moon[0]) * s, (P.moon[1] - M.moon[1]) * s, (P.moon[2] - M.moon[2]) * s] as V3,
  };
}

/** unit axes (in the inertial display frame) of a dv frame at the state */
export function frameAxes(dyn: Dyn, t: number, y: ArrayLike<number>, frame: DvFrame): [V3, V3, V3] {
  const S = inertialState(dyn, t, y);
  if (frame === 'rot') {
    const x = unit(S.rm), z = unit(crs(S.rm, S.vm));
    return [x, crs(z, x), z];
  }
  const r = frame === 'vnb-moon' ? sub(S.r, S.rm) : S.r, v = frame === 'vnb-moon' ? sub(S.v, S.vm) : S.v;
  const V = unit(v), Nn = unit(crs(r, v)), B = crs(V, Nn);
  return [V, Nn, B];
}

/** model state after an impulse dv [m/s] given in `frame` */
export function applyDv(dyn: Dyn, t: number, y: ArrayLike<number>, frame: DvFrame, dvMs: V3): { y: Float64Array; dvIn: V3 } {
  const ax = frameAxes(dyn, t, y, frame);
  const dvIn: V3 = [0, 1, 2].map((i) => (ax[0][i] * dvMs[0] + ax[1][i] * dvMs[1] + ax[2][i] * dvMs[2]) / 1000) as V3; // km/s
  const A = posJacobian(dyn, t, y);
  const b = dvIn.map((v) => (v * secPerT(dyn)) / LU) as V3; // [LU / model time]
  const dx = solve3(A, b);
  const out = Float64Array.from(y as number[]);
  out[3] += dx[0]; out[4] += dx[1]; out[5] += dx[2];
  return { y: out, dvIn };
}

/** CR3BP-equivalent pulsating velocity (d rho / d tau divided by the model rate k) */
function wEq(dyn: Dyn, t: number, y: ArrayLike<number>): V3 {
  const N = dyn.n, f = new Float64Array(N), yy = Float64Array.from(y as number[]);
  dyn.rhs(t, yy, f);
  const h = 1e-5 * dyn.tPerTau, a = [0, 0, 0], b = [0, 0, 0];
  dyn.puls(t + h, yy.map((v, i) => v + h * f[i]), a);
  dyn.puls(t - h, yy.map((v, i) => v - h * f[i]), b);
  const s = dyn.tPerTau / (2 * h * dyn.k);
  return [(a[0] - b[0]) * s, (a[1] - b[1]) * s, (a[2] - b[2]) * s];
}

export interface BurnResult {
  burn: Burn;
  dv?: V3; // m/s in the frame axes
  reached: boolean;
  tau: number;
  yBefore?: number[];
  yAfter?: number[];
  dvInertial?: V3; // km/s, inertial display frame
  dvRot?: V3; // m/s, rotating x y z
  dvMag: number; // m/s
  CBefore?: number;
  CAfter?: number;
}
export interface PlanResult {
  segs: { res: PropResult; C: number }[];
  burns: BurnResult[];
  tokens: number[];
  times: number[]; // [tau]
  status: PropResult['status'];
  tEnd: number;
  t: number[];
  P: number[][];
  I: PropResult['I'];
  breaks: number[]; // sample index where each segment after a burn starts
  totalDv: number; // m/s
}

/** forward propagation with impulsive burns at the given times (days after the section crossing) */
export function runPlan(dyn: Dyn, s0: number[], C: number, horizonDays: number, burns: Burn[]): PlanResult {
  const tEnd = horizonDays / TSTAR_DAYS;
  const act = burns.filter((b) => b.on && b.tDays > 0 && b.tDays < horizonDays).sort((a, b) => a.tDays - b.tDays);
  const segs: PlanResult['segs'] = [];
  const out: BurnResult[] = burns.map((b) => ({ burn: b, reached: false, tau: b.tDays / TSTAR_DAYS, dvMag: Math.abs(b.mag) }));
  let Cj = C, t0 = 0, y: ArrayLike<number> | null = null;
  const T: number[] = [], P: number[][] = [], I: NonNullable<PropResult['I']> = [], tokens: number[] = [], times: number[] = [], breaks: number[] = [];
  let status: PropResult['status'] = 0, last = 0;
  for (let q = 0; q <= act.length; q++) {
    const tStop = q < act.length ? act[q].tDays / TSTAR_DAYS : tEnd;
    const res = propagate(s0, { tEnd: tStop - t0, C: Cj, record: true, hMax: 0.01, dyn, ...(y ? { y0: y, t0 } : {}) });
    segs.push({ res, C: Cj });
    if (q > 0) breaks.push(T.length);
    const skip = q > 0 ? 1 : 0; // the first sample repeats the burn point
    for (let i = skip; i < res.t!.length; i++) { T.push(res.t![i]); P.push(res.P![i]); I.push(res.I![i]); } // (no spread: long HFEM records overflow the call stack)
    res.tokens.forEach((id, k) => { if (tokens[tokens.length - 1] !== id) { tokens.push(id); times.push(res.times[k]); } });
    status = res.status; last = res.tEnd;
    if (res.status !== 0 || q === act.length) break;
    // burn
    const b = act[q], tm = tStop * dyn.tPerTau, yb = res.yEnd!;
    const w0 = wEq(dyn, tm, yb);
    const { y: ya, dvIn } = applyDv(dyn, tm, yb, b.frame, dvOf(b));
    const w1 = wEq(dyn, tm, ya);
    const C1 = Cj + (w0[0] ** 2 + w0[1] ** 2 + w0[2] ** 2) - (w1[0] ** 2 + w1[1] ** 2 + w1[2] ** 2);
    const rot = frameAxes(dyn, tm, yb, 'rot');
    const o = out.find((x) => x.burn === b)!;
    Object.assign(o, {
      reached: true, dv: dvOf(b), yBefore: Array.from(yb), yAfter: Array.from(ya), dvInertial: dvIn,
      dvRot: rot.map((e) => 1000 * (e[0] * dvIn[0] + e[1] * dvIn[1] + e[2] * dvIn[2])) as V3, CBefore: Cj, CAfter: C1,
    });
    Cj = C1; t0 = tStop; y = ya;
  }
  const totalDv = out.filter((o) => o.reached).reduce((a, o) => a + o.dvMag, 0);
  return { segs, burns: out, tokens, times, status, tEnd: last, t: T, P, I, breaks, totalDv };
}

/** model state of the reference trajectory (from the section state) at time tau */
function refState(dyn: Dyn, s0: number[], C: number, tau: number): Float64Array {
  if (tau === 0) return dyn.init(s0);
  const r = propagate(s0, { tEnd: Math.abs(tau), C, dyn, dir: tau > 0 ? 1 : -1 });
  return Float64Array.from(r.yEnd!);
}

/** word of a sampled trajectory (time ascending), each sample classified with its segment's C */
function tokensFromSamples(T: number[], P: number[][], Cs: number[], startImpact: number) {
  const tokens: number[] = [], times: number[] = [];
  if (startImpact === 1 || startImpact === 2) { tokens.push(startImpact === 1 ? ID.MC : ID.EC); times.push(T[0]); }
  for (let i = 0; i < T.length; i++) {
    const id = classify(P[i][0], P[i][1], Cs[i]);
    if (tokens[tokens.length - 1] !== id) { tokens.push(id); times.push(T[i]); }
  }
  return { tokens, times };
}

/** Backward design: the trajectory after the LAST burn is the reference (it keeps passing the section if the
 *  burns are earlier); going back through each burn the state before it is (state after - dv), propagated
 *  backward. Burn times may be negative (before the section crossing). Samples cover -horizon .. +horizon. */
export function runPlanBackward(dyn: Dyn, s0: number[], C: number, horizonDays: number, burns: Burn[]): PlanResult & { now: number; Cs: number[] } {
  const H = horizonDays / TSTAR_DAYS;
  const act = burns.filter((b) => b.on && Math.abs(b.tDays) < horizonDays).sort((a, b) => a.tDays - b.tDays);
  const out: BurnResult[] = burns.map((b) => ({ burn: b, reached: false, tau: b.tDays / TSTAR_DAYS, dvMag: Math.abs(b.mag) }));
  const tN = act.length ? act[act.length - 1].tDays / TSTAR_DAYS : 0;
  const yN = refState(dyn, s0, C, tN);
  const fixed = propagate([], { y0: yN, t0: tN, tEnd: H - tN, C, record: true, hMax: 0.01, dyn });
  const parts: { res: PropResult; C: number; back: boolean }[] = [{ res: fixed, C, back: false }];
  let y: ArrayLike<number> = yN, Cj = C, startImpact = 0;
  for (let k = act.length - 1; k >= -1; k--) {
    const tk = k >= 0 ? act[k].tDays / TSTAR_DAYS : tN; // k = -1: no burn (plain past when there are no burns)
    if (k === -1 && act.length) break;
    let yb: ArrayLike<number> = y, Cb = Cj;
    if (k >= 0) {
      const b = act[k], tm = tk * dyn.tPerTau;
      const d = dvOf(b).map((v) => -v) as V3;
      const w1 = wEq(dyn, tm, y);
      const { y: ybb, dvIn } = applyDv(dyn, tm, y, b.frame, d);
      const w0 = wEq(dyn, tm, ybb);
      Cb = Cj + (w1[0] ** 2 + w1[1] ** 2 + w1[2] ** 2) - (w0[0] ** 2 + w0[1] ** 2 + w0[2] ** 2);
      const rot = frameAxes(dyn, tm, y, 'rot');
      Object.assign(out.find((x) => x.burn === b)!, {
        reached: true, dv: dvOf(b), yBefore: Array.from(ybb), yAfter: Array.from(y), dvInertial: dvIn.map((v) => -v) as V3,
        dvRot: rot.map((e) => -1000 * (e[0] * dvIn[0] + e[1] * dvIn[1] + e[2] * dvIn[2])) as V3, CBefore: Cb, CAfter: Cj,
      });
      yb = ybb;
    }
    const tPrev = k > 0 ? act[k - 1].tDays / TSTAR_DAYS : -H;
    const seg = propagate([], { y0: yb, t0: tk, tEnd: tk - tPrev, C: Cb, record: true, hMax: 0.01, dyn, dir: -1 });
    parts.unshift({ res: seg, C: Cb, back: true });
    if (seg.status !== 0) { startImpact = seg.status; for (let q = k - 1; q >= 0; q--) out.find((x) => x.burn === act[q])!.reached = false; break; }
    y = seg.yEnd!; Cj = Cb;
  }
  // assemble ascending in time
  const T: number[] = [], P: number[][] = [], I: NonNullable<PropResult['I']> = [], Cs: number[] = [], breaks: number[] = [];
  parts.forEach((pt, q) => {
    const r = pt.res, n = r.t!.length;
    if (q > 0) breaks.push(T.length);
    for (let i = 0; i < n; i++) {
      const j = pt.back ? n - 1 - i : i;
      if (q > 0 && i === 0 && !pt.back) continue; // shared burn point, keep the pre-burn copy
      T.push(r.t![j]); P.push(r.P![j]); I.push(r.I![j]); Cs.push(pt.C);
    }
  });
  const { tokens, times } = tokensFromSamples(T, P, Cs, startImpact);
  let now = T.findIndex((t) => t >= 0); if (now < 0) now = T.length - 1;
  const totalDv = out.filter((o) => o.reached).reduce((a, o) => a + o.dvMag, 0);
  return { segs: parts.map((p) => ({ res: p.res, C: p.C })), burns: out, tokens, times, status: fixed.status, tEnd: fixed.tEnd, t: T, P, I, breaks, totalDv, now, Cs };
}

/** everything the dv map needs for a burn of `frame` at tDays: the state on the far side of the burn with the
 *  other burns applied (forward: earlier ones; backward: later ones), the symbols already fixed, and a fast
 *  state(mag, alpha, beta) for the near side (forward: after the burn; backward: before it). */
export function prepareDvMap(dyn: Dyn, s0: number[], C: number, horizonDays: number, burns: Burn[], skipId: number | null, tDays: number, frame: DvFrame, backward = false) {
  const others = burns.filter((x) => x.id !== skipId && x.on);
  const tau = tDays / TSTAR_DAYS, tm = tau * dyn.tPerTau;
  let yb: ArrayLike<number>, C0: number, prefix: number[];
  if (!backward) {
    if (!(tDays > 0 && tDays < horizonDays)) return null;
    const pre = runPlan(dyn, s0, C, tDays, others.filter((x) => x.tDays < tDays));
    if (pre.status !== 0) return null; // the trajectory ends before the burn
    const seg = pre.segs[pre.segs.length - 1];
    yb = seg.res.yEnd!; C0 = seg.C; prefix = pre.tokens;
  } else {
    if (!(Math.abs(tDays) < horizonDays)) return null;
    const later = others.filter((x) => x.tDays > tDays);
    const P = runPlanBackward(dyn, s0, C, horizonDays, later);
    // state at tau on the planned trajectory (after = the side that is kept)
    const tl = later.length ? later[0].tDays / TSTAR_DAYS : Infinity;
    if (later.length && P.burns.some((b) => !b.reached)) return null;
    const base = later.length ? P.burns.find((b) => b.burn === later[0])!.yBefore! : null;
    yb = base ? Float64Array.from(propagate([], { y0: base, t0: tl, tEnd: tl - tau, C, dyn, dir: -1 }).yEnd!) : refState(dyn, s0, C, tau);
    C0 = later.length ? P.burns.find((b) => b.burn === later[0])!.CBefore! : C;
    prefix = [];
  }
  const ax = frameAxes(dyn, tm, yb, frame);
  const A = posJacobian(dyn, tm, yb);
  const kk = secPerT(dyn) / LU / 1000; // m/s -> LU / model time
  const w0 = wEq(dyn, tm, yb), w02 = w0[0] ** 2 + w0[1] ** 2 + w0[2] ** 2;
  // the model velocity change is linear in dv: precompute the images of the three frame axes
  const cols = ax.map((e) => solve3(A, e.map((v) => v * kk) as V3));
  const sg = backward ? -1 : 1;
  const state = (mag: number, alpha: number, beta: number) => {
    const d = dvComponents(frame, mag, alpha, beta);
    const y = Array.from(yb as number[]);
    for (let i = 0; i < 3; i++) y[3 + i] += sg * (cols[0][i] * d[0] + cols[1][i] * d[1] + cols[2][i] * d[2]);
    const w = wEq(dyn, tm, y);
    return { y, C: C0 + w02 - (w[0] ** 2 + w[1] ** 2 + w[2] ** 2) };
  };
  return { tau, prefix, state, n: dyn.n, C0, dir: sg as 1 | -1 };
}

/** Section-anchored design (the default "forward" mode): the state at the section is fixed. Burns after it
 *  change the future (forward chain, as runPlan); burns before it change the past (going back from the section,
 *  the state before a burn is the state after it minus dv, propagated backward). Samples cover -H .. +H. */
export function runPlanAnchored(dyn: Dyn, s0: number[], C: number, horizonDays: number, burns: Burn[]): PlanResult & { now: number } {
  const H = horizonDays / TSTAR_DAYS;
  const fut = runPlan(dyn, s0, C, horizonDays, burns);
  const neg = burns.filter((b) => b.on && b.tDays < 0 && b.tDays > -horizonDays).sort((a, b) => b.tDays - a.tDays);
  const res = new Map<Burn, BurnResult>();
  const parts: { res: PropResult; C: number }[] = [];
  let y: ArrayLike<number> = dyn.init(s0), t = 0, Cj = C, startImpact = 0;
  for (let k = 0; k <= neg.length; k++) {
    const tk = k < neg.length ? neg[k].tDays / TSTAR_DAYS : -H;
    const seg = propagate([], { y0: y, t0: t, tEnd: t - tk, dir: -1, C: Cj, record: true, hMax: 0.01, dyn });
    parts.push({ res: seg, C: Cj });
    if (seg.status !== 0) { startImpact = seg.status; break; }
    if (k === neg.length) break;
    const b = neg[k], tm = tk * dyn.tPerTau, ya = seg.yEnd!;
    const w1 = wEq(dyn, tm, ya);
    const { y: yb, dvIn } = applyDv(dyn, tm, ya, b.frame, dvOf(b).map((v) => -v) as V3);
    const w0 = wEq(dyn, tm, yb);
    const Cb = Cj + (w1[0] ** 2 + w1[1] ** 2 + w1[2] ** 2) - (w0[0] ** 2 + w0[1] ** 2 + w0[2] ** 2);
    const rot = frameAxes(dyn, tm, ya, 'rot');
    res.set(b, {
      burn: b, reached: true, tau: tk, dvMag: Math.abs(b.mag), dv: dvOf(b), yBefore: Array.from(yb), yAfter: Array.from(ya), dvInertial: dvIn.map((v) => -v) as V3,
      dvRot: rot.map((e) => -1000 * (e[0] * dvIn[0] + e[1] * dvIn[1] + e[2] * dvIn[2])) as V3, CBefore: Cb, CAfter: Cj,
    });
    y = yb; t = tk; Cj = Cb;
  }
  // past samples in time order (parts are newest first, each running backward)
  const T: number[] = [], P: number[][] = [], I: NonNullable<PropResult['I']> = [], Cs: number[] = [], breaks: number[] = [];
  for (let q = parts.length - 1; q >= 0; q--) {
    const r = parts[q].res, n = r.t!.length;
    if (q < parts.length - 1) breaks.push(T.length);
    for (let i = n - 1; i >= 0; i--) {
      if (q < parts.length - 1 && i === n - 1) continue; // shared burn point
      T.push(r.t![i]); P.push(r.P![i]); I.push(r.I![i]); Cs.push(parts[q].C);
    }
  }
  const pastTok = tokensFromSamples(T, P, Cs, startImpact);
  const now = T.length - 1;
  // future (skip its first sample: the section point is already the last past sample)
  const off = T.length - 1;
  for (let i = 1; i < fut.t.length; i++) { T.push(fut.t[i]); P.push(fut.P[i]); I.push(fut.I![i]); }
  for (const b of fut.breaks) breaks.push(b + off);
  const tokens = [...pastTok.tokens], times = [...pastTok.times];
  fut.tokens.forEach((id, k) => { if (tokens[tokens.length - 1] !== id) { tokens.push(id); times.push(fut.times[k]); } });
  const burnsOut = fut.burns.map((r) => res.get(r.burn) ?? r);
  const totalDv = burnsOut.filter((o) => o.reached).reduce((a, o) => a + o.dvMag, 0);
  return { segs: [...parts, ...fut.segs], burns: burnsOut, tokens, times, status: fut.status, tEnd: fut.tEnd, t: T, P, I, breaks, totalDv, now };
}

// ---------------------------------------------------------------------------------------------------------------
// Sequential design (screen 4). Burns are applied one after the other in the order they were made (array order).
// The trajectory is a chain of pieces over [-H, H], each defined by an anchor state; the first piece is the section
// state at t = 0. A burn takes the current state at its time and replaces the side it changes: "future" keeps
// everything before the burn and propagates state + dv forward; "past" keeps everything after the burn and
// propagates state - dv backward. Editing a burn re-applies the later ones on top of it.
interface SeqPiece { a: number; y: Float64Array; C: number; lo: number; hi: number } // times in tau

function propTo(dyn: Dyn, y: ArrayLike<number>, a: number, t: number, C: number): Float64Array | null {
  if (t === a) return Float64Array.from(y as number[]);
  const r = propagate([], { y0: y, t0: a, tEnd: Math.abs(t - a), dir: t > a ? 1 : -1, C, dyn, hMax: 0.01 });
  return r.status === 0 ? Float64Array.from(r.yEnd!) : null;
}

function buildPieces(dyn: Dyn, s0: number[], C: number, H: number, burns: Burn[]) {
  let pieces: SeqPiece[] = [{ a: 0, y: dyn.init(s0), C, lo: -H, hi: H }];
  const out: BurnResult[] = burns.map((b) => ({ burn: b, reached: false, tau: b.tDays / TSTAR_DAYS, dvMag: Math.abs(b.mag) }));
  burns.forEach((b, q) => {
    const tb = b.tDays / TSTAR_DAYS;
    if (!b.on || !(tb > -H && tb < H)) return;
    const fut = sideOf(b) === 'future';
    // the piece that holds the kept state at tb (future: the one ending at / covering tb; past: the one starting at / covering it)
    const k = pieces.findIndex((pc) => (fut ? pc.lo < tb && tb <= pc.hi : pc.lo <= tb && tb < pc.hi));
    if (k < 0) return;
    const pc = pieces[k];
    const yk = propTo(dyn, pc.y, pc.a, tb, pc.C);
    if (!yk) return; // the trajectory ends (impact) before the burn
    const tm = tb * dyn.tPerTau;
    const d = dvOf(b);
    const { y: yn, dvIn } = applyDv(dyn, tm, yk, b.frame, fut ? d : (d.map((v) => -v) as V3));
    const wk = wEq(dyn, tm, yk), wn = wEq(dyn, tm, yn);
    const Cn = pc.C + (wk[0] ** 2 + wk[1] ** 2 + wk[2] ** 2) - (wn[0] ** 2 + wn[1] ** 2 + wn[2] ** 2);
    const rot = frameAxes(dyn, tm, yk, 'rot');
    const sg = fut ? 1 : -1;
    Object.assign(out[q], {
      reached: true, dv: d, yBefore: Array.from(fut ? yk : yn), yAfter: Array.from(fut ? yn : yk),
      dvInertial: dvIn.map((v) => sg * v) as V3, dvRot: rot.map((e) => sg * 1000 * (e[0] * dvIn[0] + e[1] * dvIn[1] + e[2] * dvIn[2])) as V3,
      CBefore: fut ? pc.C : Cn, CAfter: fut ? Cn : pc.C,
    });
    if (fut) {
      pieces = [...pieces.slice(0, k), { a: tb, y: yk, C: pc.C, lo: pc.lo, hi: tb }, { a: tb, y: yn, C: Cn, lo: tb, hi: H }];
    } else {
      pieces = [{ a: tb, y: yn, C: Cn, lo: -H, hi: tb }, { a: tb, y: yk, C: pc.C, lo: tb, hi: pc.hi }, ...pieces.slice(k + 1)];
    }
  });
  return { pieces, out };
}

/** sequential plan, sampled over -H .. +H (time ascending) */
export function runPlanSeq(dyn: Dyn, s0: number[], C: number, horizonDays: number, burns: Burn[]): PlanResult & { now: number; Cs: number[] } {
  const H = horizonDays / TSTAR_DAYS;
  const { pieces, out } = buildPieces(dyn, s0, C, H, burns);
  // the piece holding t = 0 is always reachable; walk outwards from it and stop at an impact
  const k0 = Math.max(0, pieces.findIndex((pc) => pc.lo <= 0 && 0 <= pc.hi));
  const rec = new Map<number, { back?: PropResult; fwd?: PropResult }>();
  let first = k0, last = k0, startImpact = 0, status: PropResult['status'] = 0, tEnd = H;
  const runPiece = (k: number, dirs: ('back' | 'fwd')[]) => {
    const pc = pieces[k], r = rec.get(k) ?? {};
    if (dirs.includes('back') && pc.a > pc.lo) r.back = propagate([], { y0: pc.y, t0: pc.a, tEnd: pc.a - pc.lo, dir: -1, C: pc.C, record: true, hMax: 0.01, dyn });
    if (dirs.includes('fwd') && pc.a < pc.hi) r.fwd = propagate([], { y0: pc.y, t0: pc.a, tEnd: pc.hi - pc.a, C: pc.C, record: true, hMax: 0.01, dyn });
    rec.set(k, r);
    return r;
  };
  const r0 = runPiece(k0, ['back', 'fwd']);
  let goBack = !(r0.back && r0.back.status !== 0), goFwd = !(r0.fwd && r0.fwd.status !== 0);
  if (!goBack) startImpact = r0.back!.status;
  if (!goFwd) { status = r0.fwd!.status; tEnd = r0.fwd!.tEnd; }
  for (let k = k0 - 1; goBack && k >= 0; k--) {
    const r = runPiece(k, ['back', 'fwd']); first = k; // pieces before the section are anchored at their upper end
    if (r.back && r.back.status !== 0) { startImpact = r.back.status; goBack = false; }
  }
  for (let k = k0 + 1; goFwd && k < pieces.length; k++) {
    const r = runPiece(k, ['back', 'fwd']); last = k;
    if (r.fwd && r.fwd.status !== 0) { status = r.fwd.status; tEnd = r.fwd.tEnd; goFwd = false; }
  }
  const T: number[] = [], P: number[][] = [], I: NonNullable<PropResult['I']> = [], Cs: number[] = [], breaks: number[] = [];
  const push = (r: PropResult, rev: boolean, C0: number, skipFirst: boolean) => {
    const n = r.t!.length;
    for (let i = 0; i < n; i++) {
      const j = rev ? n - 1 - i : i;
      if (skipFirst && i === 0) continue;
      if (T.length && r.t![j] < T[T.length - 1]) continue;
      T.push(r.t![j]); P.push(r.P![j]); I.push(r.I![j]); Cs.push(C0);
    }
  };
  for (let k = first; k <= last; k++) {
    const pc = pieces[k], r = rec.get(k)!;
    if (k > first) breaks.push(T.length);
    if (r.back) push(r.back, true, pc.C, false);
    if (r.fwd) push(r.fwd, false, pc.C, !!r.back);
  }
  const { tokens, times } = tokensFromSamples(T, P, Cs, startImpact);
  if ((status === 1 || status === 2) && T.length) { tokens.push(status === 1 ? ID.MC : ID.EC); times.push(T[T.length - 1]); }
  let now = T.findIndex((t) => t >= 0); if (now < 0) now = T.length - 1;
  const totalDv = out.filter((o) => o.reached).reduce((a, o) => a + o.dvMag, 0);
  const segs = pieces.slice(first, last + 1).map((pc, q) => { const r = rec.get(first + q)!; return { res: (r.fwd ?? r.back)!, C: pc.C }; });
  return { segs, burns: out, tokens, times, status, tEnd: Math.min(tEnd, T.length ? T[T.length - 1] : 0), t: T, P, I, breaks, totalDv, now, Cs };
}

/** dv map for a burn in the sequential design: `prior` are the burns applied before it (in order). The state on the
 *  kept side at tDays comes from that plan; state(mag, alpha, beta) gives the changed side. */
export function prepareDvMapSeq(dyn: Dyn, s0: number[], C: number, horizonDays: number, prior: Burn[], tDays: number, frame: DvFrame, side: BurnSide) {
  const H = horizonDays / TSTAR_DAYS, tau = tDays / TSTAR_DAYS, tm = tau * dyn.tPerTau;
  if (!(tau > -H && tau < H) || Math.abs(tDays) < 1e-6) return null;
  const fut = side === 'future';
  const { pieces } = buildPieces(dyn, s0, C, H, prior);
  const k = pieces.findIndex((pc) => (fut ? pc.lo < tau && tau <= pc.hi : pc.lo <= tau && tau < pc.hi));
  if (k < 0) return null;
  const pc = pieces[k];
  const yb = propTo(dyn, pc.y, pc.a, tau, pc.C);
  if (!yb) return null;
  const C0 = pc.C;
  // symbols already fixed between the section and a later burn (for matching your word)
  let prefix: number[] = [];
  if (fut && tau > 0) {
    const pl = runPlanSeq(dyn, s0, C, horizonDays, prior);
    let q0 = 0; for (let q = 0; q < pl.times.length; q++) if (pl.times[q] <= 0) q0 = q;
    prefix = pl.tokens.slice(q0).filter((_, q) => pl.times[q0 + q] <= tau);
  }
  const ax = frameAxes(dyn, tm, yb, frame);
  const A = posJacobian(dyn, tm, yb);
  const kk = secPerT(dyn) / LU / 1000;
  const w0 = wEq(dyn, tm, yb), w02 = w0[0] ** 2 + w0[1] ** 2 + w0[2] ** 2;
  const cols = ax.map((e) => solve3(A, e.map((v) => v * kk) as V3));
  const sg = fut ? 1 : -1;
  const state = (mag: number, alpha: number, beta: number) => {
    const d = dvComponents(frame, mag, alpha, beta);
    const y = Array.from(yb);
    for (let i = 0; i < 3; i++) y[3 + i] += sg * (cols[0][i] * d[0] + cols[1][i] * d[1] + cols[2][i] * d[2]);
    const w = wEq(dyn, tm, y);
    return { y, C: C0 + w02 - (w[0] ** 2 + w[1] ** 2 + w[2] ** 2) };
  };
  return { tau, prefix, state, n: dyn.n, C0, dir: sg as 1 | -1 };
}
