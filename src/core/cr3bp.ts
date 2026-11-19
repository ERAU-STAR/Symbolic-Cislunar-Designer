// Model-agnostic DOP853 propagation with on-line symbolic tracking.
// Region ids are taken from each model's own Earth-Moon pulsating frame.
import { MU, twoU } from './constants';
import { A, B, C as CS, E3, E5 } from './dop853_coeffs';
import { classify } from './partition';
import { isLunar, ID } from './symbols';
import { makeDyn, type Dyn, type Inertial } from './models';

export type State = number[]; // section state [x y z vx vy vz] (instantaneous units)

export function jacobi(s: State): number {
  return twoU(s[0], s[1], s[2]) - (s[3] ** 2 + s[4] ** 2 + s[5] ** 2);
}

export interface PropOptions {
  tEnd: number; // [tau = t/TSTAR], magnitude
  dir?: 1 | -1; // -1 = backward in time
  dyn?: Dyn; // default CR3BP
  hMax?: number; // [tau], also bounds region-detection gaps
  C?: number; // Jacobi constant used for the L1/L2 gating of M_L / M_R
  record?: boolean; // keep every accepted step (screen 3)
  /** early stop: called after each new token; return true to stop */
  stop?: (tokens: number[]) => boolean;
  /** start from a model state at model time t0*tPerTau instead of the section state (maneuver segments) */
  y0?: ArrayLike<number>;
  t0?: number; // [tau]
}

export interface PropResult {
  tokens: number[]; // fine region ids, consecutive duplicates removed
  times: number[]; // entry time of each token [tau]
  status: 0 | 1 | 2 | 3; // 0 horizon, 1 Moon impact, 2 Earth impact, 3 stopped early
  tEnd: number; // [tau]
  t?: number[]; // [tau]
  P?: number[][]; // pulsating (x, y, z)
  I?: Inertial[]; // inertial snapshots (Earth-centred, epoch Earth-Moon plane)
  Y0?: number[]; // model initial state
  yEnd?: number[]; // model state at tEnd
}

let defaultDyn: Dyn | null = null;

export function propagate(x0: State, o: PropOptions): PropResult {
  const dyn = o.dyn ?? (defaultDyn ??= makeDyn({ kind: 'cr3bp' }));
  const N = dyn.n, sc = dyn.tPerTau, dir = o.dir ?? 1;
  const hMax = (o.hMax ?? 0.02) * sc, tEnd = o.tEnd * sc, hImp = 2e-5 * sc; // ~ 7.5 s
  const rtol = dyn.rtol, atol = dyn.atol;
  const Cj = o.C ?? jacobi(x0);
  const K: Float64Array[] = Array.from({ length: 13 }, () => new Float64Array(N));
  const tS = (o.t0 ?? 0) * sc; // start time (model units)
  let y = o.y0 ? Float64Array.from(o.y0) : dyn.init(x0);
  const Y0 = Array.from(y);
  const yy = new Float64Array(N), ynew = new Float64Array(N), fnew = new Float64Array(N);
  let f0 = new Float64Array(N);
  dyn.rhs(tS, y, f0);
  let t = tS, h = 1e-3 * sc;
  const pos = [0, 0, 0];
  const tokens: number[] = [], times: number[] = [];
  const push = (id: number, tt: number) => {
    if (tokens.length && tokens[tokens.length - 1] === id) return false;
    tokens.push(id); times.push(tt / sc); return true;
  };
  dyn.puls(tS, y, pos);
  // first token from the section state itself (exactly on the section, any model)
  push(o.y0 ? classify(pos[0], pos[1], Cj) : classify(x0[0], x0[1], Cj), tS);
  const rec = o.record ? { t: [tS / sc], P: [[pos[0], pos[1], pos[2]]], I: [dyn.inertial(tS, y)] } : null;
  let status: PropResult['status'] = 0;
  let steps = 0;
  // t runs 0 -> dir*tEnd; h is the step magnitude, hs the signed step
  const tFin = tS + dir * tEnd;
  while (dir * (t - tS) < tEnd && steps < 2_000_000) {
    // remaining time below the rounding of t (large model times, e.g. seconds in HFEM): done
    if (dir * (tFin - t) <= 1e-12 * Math.max(1, Math.abs(t))) break;
    if (h > hMax) h = hMax;
    let last = false;
    if (dir * (t - tS) + h >= tEnd) { h = dir * (tFin - t); last = true; }
    const hs = dir * h;
    K[0].set(f0);
    for (let s = 1; s < 12; s++) {
      const As = A[s];
      for (let i = 0; i < N; i++) {
        let acc = y[i];
        for (let j = 0; j < s; j++) acc += hs * As[j] * K[j][i];
        yy[i] = acc;
      }
      dyn.rhs(t + CS[s] * hs, yy, K[s]);
    }
    for (let i = 0; i < N; i++) {
      let acc = y[i];
      for (let s = 0; s < 12; s++) acc += hs * B[s] * K[s][i];
      ynew[i] = acc;
    }
    dyn.rhs(t + hs, ynew, fnew); K[12].set(fnew);
    let e5 = 0, e3 = 0;
    for (let i = 0; i < N; i++) {
      const scl = atol + Math.max(Math.abs(y[i]), Math.abs(ynew[i])) * rtol;
      let a5 = 0, a3 = 0;
      for (let s = 0; s < 13; s++) { a5 += K[s][i] * E5[s]; a3 += K[s][i] * E3[s]; }
      e5 += (a5 / scl) ** 2; e3 += (a3 / scl) ** 2;
    }
    const den = e5 + 0.01 * e3;
    const err = den > 0 ? (Math.abs(h) * e5) / Math.sqrt(den * N) : 0;
    steps++;
    if (!(err <= 1) && !isFinite(err)) { h *= 0.2; if (h < 1e-12 * sc) break; continue; }
    // a step that ends inside the Earth or the Moon is retried shorter, so the regions crossed just before the
    // impact (e.g. M_1 -> M_2 across x = x_Moon, which passes through the Moon) are recorded in order
    if (err <= 1 && h > hImp && dyn.impact(last ? tFin : t + hs, ynew)) { h *= 0.25; continue; }
    if (err <= 1) {
      t = last ? tFin : t + hs; y = Float64Array.from(ynew); f0 = Float64Array.from(fnew);
      dyn.puls(t, y, pos);
      if (rec) { rec.t.push(t / sc); rec.P.push([pos[0], pos[1], pos[2]]); rec.I.push(dyn.inertial(t, y)); }
      const imp = dyn.impact(t, y);
      if (imp === 1) { push(ID.MC, t); status = 1; break; }
      if (imp === 2) { push(ID.EC, t); status = 2; break; }
      if (push(classify(pos[0], pos[1], Cj), t) && o.stop && o.stop(tokens)) { status = 3; break; }
      const fac = err > 0 ? 0.9 * err ** (-1 / 8) : 10;
      h *= Math.min(10, Math.max(0.2, fac));
    } else {
      h *= Math.max(0.2, 0.9 * err ** (-1 / 8));
    }
  }
  const out: PropResult = { tokens, times, status, tEnd: t / sc, Y0, yEnd: Array.from(y) };
  if (rec) { out.t = rec.t; out.P = rec.P; out.I = rec.I; }
  return out;
}

/** index where the paper's class word ends: first non-lunar token after the lunar entry */
export function classEnd(tokens: number[]): number {
  let entered = false;
  for (let k = 0; k < tokens.length; k++) {
    if (isLunar(tokens[k])) entered = true;
    else if (entered) return k;
  }
  return -1;
}

export { MU };
