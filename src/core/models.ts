// Dynamical models shared by the UI and the map workers.
// Every model exchanges states in the SAME convention: a section state is
// [rho, rho'] with rho the barycentric Earth-Moon pulsating position and
// rho' = d rho / d tau' (tau' = instantaneous frame rotation angle). Each model
// converts rho' with its own frame rate: d rho/d tau = rho' * omega_m * tstar
// ("same position + instantaneous angular-rate normalisation"), so psi1, psi2
// and C_ref are identical in every model.
import { MU } from './constants';

export const TSTAR_S = 2360592 / (2 * Math.PI); // [s]
export const LSTAR = 3.847480123366294e5; // [km]
export const GM_E = 398600.4418, GM_M = 4902.801076, GM_S = 132712440041.9394;
export const GM_EM = GM_E + GM_M;
export const ECC = 0.055;
export const SMA = LSTAR / Math.sqrt(1 - ECC * ECC); // ER3BP .cpp convention
export const RE_KM = 6378.137, RM_KM = 1737.4;
export const LSB = 149598058.09228115, GS_Q = 132712200000.0;
export const TSB = Math.sqrt(LSB ** 3 / GS_Q); // Hill time unit 1/n' [s]
export const LH = LSB * (GM_EM / GS_Q) ** (1 / 3); // Hill length [km]

type V3 = [number, number, number];
export interface Inertial { sc: V3; moon: V3; sun?: V3 } // sun: unit direction
const LU = 384400; // display length unit [km]

export type ModelKind = 'cr3bp' | 'er3bp' | 'hr4bp' | 'qhr4bp_ecc' | 'qhr4bp_inc' | 'hfem';

/** serialisable model description (built on the main thread, sent to workers once) */
export type ModelParams =
  | { kind: 'cr3bp' }
  | { kind: 'er3bp'; f0: number }
  | { kind: 'hill'; label: ModelKind; h: number; tg0: number; R: Float64Array; V: Float64Array; period: number; offset: number } // row q at t = tg0 + q*h
  | { kind: 'hfem'; h: number; t0: number; tab: Float64Array }; // tab rows: Moon r(3) v(3), Sun r(3) v(3) at q*h - t0 [s]

export interface Dyn {
  n: number;
  tPerTau: number; // model time units per tau (= t/TSTAR)
  rtol: number;
  atol: number;
  rhs(t: number, y: Float64Array, d: Float64Array): void;
  /** pulsating position (barycentric, EM units): out[0..2] = x, y, z */
  puls(t: number, y: Float64Array, out: number[]): void;
  /** 0 none, 1 Moon impact, 2 Earth impact */
  impact(t: number, y: Float64Array): number;
  /** model initial state from a section state [rho, rho'] (instantaneous units) */
  init(X: number[]): Float64Array;
  /** omega_m * tstar of the model frame at the epoch */
  k: number;
  /** Earth-Moon distance of the model at the epoch [km] */
  l0: number;
  /** length unit of the pulsating frame at t [km] (for display) */
  ell(t: number, y: Float64Array): number;
  /** inertial snapshot for display: Earth-centred, Earth-Moon plane at the epoch, Moon on +x at t = 0,
   *  units of 384 400 km; sun = unit direction to the Sun (models with the Sun only) */
  inertial(t: number, y: Float64Array): Inertial;
}

// ---------------------------------------------------------------- helpers
function grav(x: number, y: number, z: number, ex: number, ey: number, ez: number, mx: number, my: number, mz: number, mu: number, a: number[]) {
  const dx1 = x - ex, dy1 = y - ey, dz1 = z - ez, dx2 = x - mx, dy2 = y - my, dz2 = z - mz;
  const r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1), r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
  const a1 = (1 - mu) / (r1 * r1 * r1), a2 = mu / (r2 * r2 * r2);
  a[0] = -a1 * dx1 - a2 * dx2; a[1] = -a1 * dy1 - a2 * dy2; a[2] = -a1 * dz1 - a2 * dz2;
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.sqrt(dot(a, a));

/** cubic Hermite on a uniform table (row stride `st`, value at col c, derivative at col dc) */
function herm(tab: Float64Array, st: number, h: number, t: number, nrow: number, c: number, dc: number, out: number[], deriv = false) {
  let s = t / h, k = Math.floor(s);
  if (k < 0) k = 0;
  if (k > nrow - 2) k = nrow - 2;
  const u = s - k, h2 = h;
  const o0 = k * st, o1 = o0 + st;
  if (!deriv) {
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    for (let i = 0; i < 3; i++) out[i] = h00 * tab[o0 + c + i] + h10 * h2 * tab[o0 + dc + i] + h01 * tab[o1 + c + i] + h11 * h2 * tab[o1 + dc + i];
  } else {
    const d00 = (6 * u * u - 6 * u) / h2, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h2, d11 = 3 * u * u - 2 * u;
    for (let i = 0; i < 3; i++) out[i] = d00 * tab[o0 + c + i] + d10 * tab[o0 + dc + i] + d01 * tab[o1 + c + i] + d11 * tab[o1 + dc + i];
  }
}

// ---------------------------------------------------------------- CR3BP
const RE_ND = RE_KM / 384399, RM_ND = RM_KM / 384399; // planar E_C / M_C radii used by the partition
function cr3bp(): Dyn {
  const a = [0, 0, 0];
  return {
    n: 6, tPerTau: 1, rtol: 1e-10, atol: 1e-12, k: 1, l0: LSTAR,
    rhs(_t, y, d) {
      grav(y[0], y[1], y[2], -MU, 0, 0, 1 - MU, 0, 0, MU, a);
      d[0] = y[3]; d[1] = y[4]; d[2] = y[5];
      d[3] = 2 * y[4] + y[0] + a[0]; d[4] = -2 * y[3] + y[1] + a[1]; d[5] = a[2];
    },
    puls(_t, y, o) { o[0] = y[0]; o[1] = y[1]; o[2] = y[2]; },
    impact(_t, y) {
      if (Math.hypot(y[0] - 1 + MU, y[1], y[2]) <= RM_ND) return 1;
      if (Math.hypot(y[0] + MU, y[1], y[2]) <= RE_ND) return 2;
      return 0;
    },
    init: (X) => Float64Array.from(X),
    ell: () => LSTAR,
    inertial(t, y) {
      const c = Math.cos(t), s = Math.sin(t), x = y[0] + MU, yy = y[1], f = LSTAR / LU;
      return { sc: [f * (x * c - yy * s), f * (x * s + yy * c), f * y[2]], moon: [f * c, f * s, 0] };
    },
  };
}

// ---------------------------------------------------------------- ER3BP (uniform tau, state [rho, rho_tau, f])
function er3bp(f0: number): Dyn {
  const a = [0, 0, 0];
  const pp = SMA * (1 - ECC * ECC), hh = Math.sqrt(GM_EM * pp);
  const ell = (f: number) => pp / (1 + ECC * Math.cos(f));
  const k = (hh / ell(f0) ** 2) * TSTAR_S;
  return {
    n: 7, tPerTau: 1, rtol: 1e-10, atol: 1e-12, k, l0: ell(f0),
    rhs(_t, y, d) {
      const f = y[6], l = ell(f), fd = hh / (l * l), ld = (ECC * Math.sin(f) * hh) / pp, ldd = (hh * hh) / l ** 3 - GM_EM / (l * l);
      const s = TSTAR_S, om = fd * s, c4 = (-2 * ld / l) * s, c7 = (-ldd / l + fd * fd) * s * s, c12 = (-ldd / l) * s * s, g = (GM_EM / l ** 3) * s * s;
      grav(y[0], y[1], y[2], -MU, 0, 0, 1 - MU, 0, 0, MU, a);
      d[0] = y[3]; d[1] = y[4]; d[2] = y[5];
      d[3] = c4 * y[3] + 2 * om * y[4] + c7 * y[0] + g * a[0];
      d[4] = c4 * y[4] - 2 * om * y[3] + c7 * y[1] + g * a[1];
      d[5] = c4 * y[5] + c12 * y[2] + g * a[2];
      d[6] = fd * s;
    },
    puls(_t, y, o) { o[0] = y[0]; o[1] = y[1]; o[2] = y[2]; },
    impact(_t, y) {
      const l = ell(y[6]);
      if (Math.hypot(y[0] - 1 + MU, y[1], y[2]) * l <= RM_KM) return 1;
      if (Math.hypot(y[0] + MU, y[1], y[2]) * l <= RE_KM) return 2;
      return 0;
    },
    init: (X) => Float64Array.from([X[0], X[1], X[2], X[3] * k, X[4] * k, X[5] * k, f0]),
    ell: (_t, y) => ell(y[6]),
    inertial(_t, y) {
      const th = y[6] - f0, c = Math.cos(th), s = Math.sin(th), l = ell(y[6]) / LU, x = y[0] + MU;
      return { sc: [l * (x * c - y[1] * s), l * (x * s + y[1] * c), l * y[2]], moon: [l * c, l * s, 0] };
    },
  };
}

// ---------------------------------------------------------------- Hill restricted 4BP (HR4BP / QHR4BP)
// Hill frame: origin EMB, x Sun->EMB, units LH and 1/n'. Earth at -mu r, Moon at (1-mu) r,
// r = Moon - Earth from the LVO (HR4BP) or the QPO (QHR4BP) table.
function hill(p: Extract<ModelParams, { kind: 'hill' }>): Dyn {
  const tab = new Float64Array(p.R.length * 2);
  const nrow = p.R.length / 3;
  for (let q = 0; q < nrow; q++) for (let i = 0; i < 3; i++) { tab[6 * q + i] = p.R[3 * q + i]; tab[6 * q + 3 + i] = p.V[3 * q + i]; }
  const r = [0, 0, 0], v = [0, 0, 0];
  const em = (t: number) => {
    let tt = t + p.offset;
    if (p.period > 0) tt = ((tt % p.period) + p.period) % p.period;
    else tt -= p.tg0;
    herm(tab, 6, p.h, tt, nrow, 0, 3, r);
    herm(tab, 6, p.h, tt, nrow, 0, 3, v, true);
  };
  const frame = (t: number) => {
    em(t);
    const l = norm(r), xh = r.map((c) => c / l), hv = cross(r, v), hn = norm(hv), zh = hv.map((c) => c / hn), yh = cross(zh, xh);
    return { l, xh, yh, zh, r: r.slice(), v: v.slice(), hn };
  };
  const F0 = frame(0);
  const k = (F0.hn / (F0.l * F0.l) + F0.zh[2]) * (TSTAR_S / TSB); // relative EM rate + Hill-frame rotation projected on the EM normal
  const a0 = Math.atan2(F0.r[1], F0.r[0]);
  const g = [0, 0, 0];
  return {
    n: 6, tPerTau: TSTAR_S / TSB, rtol: 1e-10, atol: 1e-12, k, l0: F0.l * LH,
    rhs(t, y, d) {
      em(t);
      grav(y[0], y[1], y[2], -MU * r[0], -MU * r[1], -MU * r[2], (1 - MU) * r[0], (1 - MU) * r[1], (1 - MU) * r[2], MU, g);
      d[0] = y[3]; d[1] = y[4]; d[2] = y[5];
      d[3] = 2 * y[4] + 3 * y[0] + g[0]; d[4] = -2 * y[3] + g[1]; d[5] = -y[2] + g[2];
    },
    puls(t, y, o) {
      em(t);
      const l = norm(r), hv = cross(r, v), hn = norm(hv);
      const xh = [r[0] / l, r[1] / l, r[2] / l], zh = [hv[0] / hn, hv[1] / hn, hv[2] / hn], yh = cross(zh, xh);
      o[0] = (xh[0] * y[0] + xh[1] * y[1] + xh[2] * y[2]) / l;
      o[1] = (yh[0] * y[0] + yh[1] * y[1] + yh[2] * y[2]) / l;
      o[2] = (zh[0] * y[0] + zh[1] * y[1] + zh[2] * y[2]) / l;
    },
    impact(t, y) {
      em(t);
      const dm = Math.hypot(y[0] - (1 - MU) * r[0], y[1] - (1 - MU) * r[1], y[2] - (1 - MU) * r[2]) * LH;
      if (dm <= RM_KM) return 1;
      const de = Math.hypot(y[0] + MU * r[0], y[1] + MU * r[1], y[2] + MU * r[2]) * LH;
      return de <= RE_KM ? 2 : 0;
    },
    init(X) {
      // puls_to_hill at t = 0 with rho' scaled by the model rate k
      const { l, xh, yh, zh, r: r0, v: v0, hn } = F0;
      const rr = Math.sqrt(dot(r0, r0)) ** 3;
      const acc = [2 * v0[1] + 3 * r0[0] - r0[0] / rr, -2 * v0[0] - r0[1] / rr, -r0[2] - r0[2] / rr]; // Hill EM equations
      const ld = dot(xh, v0);
      const xd = [0, 1, 2].map((i) => (v0[i] - ld * xh[i]) / l);
      const hd = cross(r0, acc), zz = dot(zh, hd);
      const zd = [0, 1, 2].map((i) => (hd[i] - zz * zh[i]) / hn);
      const a1 = cross(zd, xh), a2 = cross(zh, xd), yd = [0, 1, 2].map((i) => a1[i] + a2[i]);
      const rho = [X[0], X[1], X[2]];
      const rhod = [X[3], X[4], X[5]].map((c) => c * k * (TSB / TSTAR_S));
      const Rm = (w: number[]) => [0, 1, 2].map((i) => xh[i] * w[0] + yh[i] * w[1] + zh[i] * w[2]);
      const Rd = (w: number[]) => [0, 1, 2].map((i) => xd[i] * w[0] + yd[i] * w[1] + zd[i] * w[2]);
      const Rr = Rm(rho), Rdr = Rd(rho), Rv = Rm(rhod);
      return Float64Array.from([l * Rr[0], l * Rr[1], l * Rr[2], ld * Rr[0] + l * Rdr[0] + l * Rv[0], ld * Rr[1] + l * Rdr[1] + l * Rv[1], ld * Rr[2] + l * Rdr[2] + l * Rv[2]]);
    },
    ell(t) { em(t); return norm(r) * LH; },
    inertial(t, y) {
      // Hill frame rotates at n' (1 per Hill time unit): inertial = Rot(t) * Hill, then Rot(-a0) so the Moon starts on +x
      em(t);
      const a = t - a0, c = Math.cos(a), s = Math.sin(a), f = LH / LU;
      const rot = (u: number, v: number, w: number): V3 => [u * c - v * s, u * s + v * c, w];
      return {
        sc: rot(f * (y[0] + MU * r[0]), f * (y[1] + MU * r[1]), f * (y[2] + MU * r[2])),
        moon: rot(f * r[0], f * r[1], f * r[2]),
        sun: rot(-1, 0, 0), // Sun on -x of the Hill frame (x = Sun -> EMB)
      };
    },
  };
}

// ---------------------------------------------------------------- HFEM (geocentric J2000, km, s; Earth + Moon + Sun)
function hfem(p: Extract<ModelParams, { kind: 'hfem' }>): Dyn {
  const nrow = p.tab.length / 12;
  const rM = [0, 0, 0], vM = [0, 0, 0], rS = [0, 0, 0];
  const moon = (t: number) => { herm(p.tab, 12, p.h, t + p.t0, nrow, 0, 3, rM); herm(p.tab, 12, p.h, t + p.t0, nrow, 0, 3, vM, true); };
  moon(0);
  const l0 = norm(rM), h0 = cross(rM, vM);
  const k = (norm(h0) / (l0 * l0)) * TSTAR_S;
  const basis = () => {
    const l = norm(rM), xh = rM.map((c) => c / l), hv = cross(rM, vM), hn = norm(hv), zh = hv.map((c) => c / hn), yh = cross(zh, xh);
    return { l, xh, yh, zh, w: hn / (l * l), ld: dot(rM, vM) / l };
  };
  moon(0);
  const B0 = basis(); // Earth-Moon plane at the epoch
  return {
    n: 6, tPerTau: TSTAR_S, rtol: 1e-10, atol: 1e-7, k, l0,
    rhs(t, y, d) {
      herm(p.tab, 12, p.h, t + p.t0, nrow, 0, 3, rM);
      herm(p.tab, 12, p.h, t + p.t0, nrow, 6, 9, rS);
      d[0] = y[3]; d[1] = y[4]; d[2] = y[5];
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2], r3 = r2 * Math.sqrt(r2);
      let ax = (-GM_E * y[0]) / r3, ay = (-GM_E * y[1]) / r3, az = (-GM_E * y[2]) / r3;
      for (const [b, G] of [[rM, GM_M], [rS, GM_S]] as [number[], number][]) {
        const dx = y[0] - b[0], dy = y[1] - b[1], dz = y[2] - b[2];
        const d3 = (dx * dx + dy * dy + dz * dz) ** 1.5, b3 = (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]) ** 1.5;
        ax -= G * (dx / d3 + b[0] / b3); ay -= G * (dy / d3 + b[1] / b3); az -= G * (dz / d3 + b[2] / b3);
      }
      d[3] = ax; d[4] = ay; d[5] = az;
    },
    puls(t, y, o) {
      moon(t);
      const { l, xh, yh, zh } = basis();
      o[0] = dot(xh, [y[0], y[1], y[2]]) / l - MU;
      o[1] = dot(yh, [y[0], y[1], y[2]]) / l;
      o[2] = dot(zh, [y[0], y[1], y[2]]) / l;
    },
    impact(t, y) {
      herm(p.tab, 12, p.h, t + p.t0, nrow, 0, 3, rM);
      if (Math.hypot(y[0] - rM[0], y[1] - rM[1], y[2] - rM[2]) <= RM_KM) return 1;
      return Math.hypot(y[0], y[1], y[2]) <= RE_KM ? 2 : 0;
    },
    init(X) {
      moon(0);
      const { l, xh, yh, zh, w, ld } = basis();
      const rb = [X[0] + MU, X[1], X[2]];
      const rr = rb.map((c) => c * l);
      const vv = [0, 1, 2].map((i) => (X[3 + i] * k * l) / TSTAR_S + ld * rb[i]);
      const wr = [-w * rr[1], w * rr[0], 0];
      const vin = [0, 1, 2].map((i) => vv[i] + wr[i]);
      const toJ = (u: number[]) => [0, 1, 2].map((i) => xh[i] * u[0] + yh[i] * u[1] + zh[i] * u[2]);
      return Float64Array.from([...toJ(rr), ...toJ(vin)]);
    },
    ell(t) { moon(t); return norm(rM); },
    inertial(t, y) {
      herm(p.tab, 12, p.h, t + p.t0, nrow, 0, 3, rM);
      herm(p.tab, 12, p.h, t + p.t0, nrow, 6, 9, rS);
      const pr = (u: number[]): V3 => [dot(u, B0.xh) / LU, dot(u, B0.yh) / LU, dot(u, B0.zh) / LU];
      const sn = pr(rS), sl = Math.hypot(sn[0], sn[1], sn[2]);
      return { sc: pr([y[0], y[1], y[2]]), moon: pr(rM), sun: [sn[0] / sl, sn[1] / sl, sn[2] / sl] };
    },
  };
}

export function makeDyn(p: ModelParams): Dyn {
  switch (p.kind) {
    case 'cr3bp': return cr3bp();
    case 'er3bp': return er3bp(p.f0);
    case 'hill': return hill(p);
    case 'hfem': return hfem(p);
  }
}
