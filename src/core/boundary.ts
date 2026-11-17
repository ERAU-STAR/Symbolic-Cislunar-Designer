// Section on any graph edge: every reciprocal edge <S_i, S_j> is a piece of one of
// the partition's boundary curves. A boundary is parametrised by s (angle in deg or
// a coordinate) with a unit normal; a section state sits on the source side
// (1e-9 off the curve) with speed from C and velocity angle psi2 (rotating frame,
// deg from +x), and only velocities pointing into the target region are sampled.
import { A_STAR, B_STAR, X_MOON, X_EARTH, X_L1, X_L2, X_G, R_G, L4, R_EARTH, twoU } from './constants';
import { classify } from './partition';
import { ID } from './symbols';
import type { State } from './cr3bp';

const D2R = Math.PI / 180;

export interface Shape {
  id: string;
  label: string; // axis label of s
  unit: 'deg' | 'nd';
  s0: number;
  s1: number;
  step: number;
  periodic: boolean;
  pt(s: number): [number, number];
  nrm(s: number): [number, number]; // unit normal
}

const unit = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y); return [x / l, y / l]; };
const rayAng = Math.atan2(L4[1], L4[0] - X_EARTH);

export const SHAPES: Shape[] = [
  {
    id: 'ellipse', label: 'ψ₁ on the lunar ellipse [deg]', unit: 'deg', s0: 0, s1: 360, step: 0.05, periodic: true,
    pt: (s) => [X_MOON + A_STAR * Math.cos(s * D2R), B_STAR * Math.sin(s * D2R)],
    nrm: (s) => unit(Math.cos(s * D2R) / A_STAR, Math.sin(s * D2R) / B_STAR),
  },
  {
    id: 'circle', label: 'ψ₁ on the L3–L4–L5 circle [deg]', unit: 'deg', s0: 0, s1: 360, step: 0.05, periodic: true,
    pt: (s) => [X_G + R_G * Math.cos(s * D2R), R_G * Math.sin(s * D2R)],
    nrm: (s) => [Math.cos(s * D2R), Math.sin(s * D2R)],
  },
  ...([['L1', X_L1], ['Moon', X_MOON], ['L2', X_L2], ['0', 0]] as [string, number][]).map(([n, c]): Shape => ({
    id: `x=${n}`, label: `y on the line x = x_${n === '0' ? '0' : n} [ndim]`, unit: 'nd', s0: -2.5, s1: 2.5, step: 0.001, periodic: false,
    pt: (s) => [c, s], nrm: () => [1, 0],
  })),
  {
    id: 'y=0', label: 'x on the line y = 0 [ndim]', unit: 'nd', s0: -2.5, s1: 2.5, step: 0.001, periodic: false,
    pt: (s) => [s, 0], nrm: () => [0, 1],
  },
  ...([['L4', rayAng], ['L5', -rayAng]] as [string, number][]).map(([n, a]): Shape => ({
    id: `ray ${n}`, label: `distance from Earth along the Earth–${n} ray [ndim]`, unit: 'nd', s0: R_EARTH * 1.5, s1: 1.1, step: 0.0005, periodic: false,
    pt: (s) => [X_EARTH + s * Math.cos(a), s * Math.sin(a)], nrm: () => [-Math.sin(a), Math.cos(a)],
  })),
];

export interface Piece { shape: Shape; s0: number; s1: number; sign: 1 | -1 } // sign: target on the +normal side
export interface Section { src: number; tgt: number; piece: Piece }

const BODY = new Set<number>([ID.EC, ID.MC]);

/** boundary pieces separating src and tgt that are energetically accessible at C */
export function edgePieces(src: number, tgt: number, C: number): Piece[] {
  if (BODY.has(src) || BODY.has(tgt) || src === tgt) return [];
  const out: Piece[] = [];
  for (const sh of SHAPES) {
    const n = Math.round((sh.s1 - sh.s0) / sh.step);
    let start: number | null = null, sgn: 1 | -1 = 1;
    const flush = (end: number) => { if (start !== null && end - start > sh.step * 2) out.push({ shape: sh, s0: start, s1: end, sign: sgn }); start = null; };
    for (let k = 0; k <= n; k++) {
      const s = sh.s0 + k * sh.step;
      const [x, y] = sh.pt(s), [nx, ny] = sh.nrm(s), d = 1e-6;
      let g: 0 | 1 | -1 = 0;
      if (k < n && twoU(x, y) > C) {
        const a = classify(x + d * nx, y + d * ny, C), b = classify(x - d * nx, y - d * ny, C);
        if (a === tgt && b === src) g = 1;
        else if (a === src && b === tgt) g = -1;
      }
      if (g === 0 || (start !== null && g !== sgn)) flush(s - sh.step);
      if (g !== 0 && start === null) { start = s; sgn = g; }
    }
    flush(sh.s1);
  }
  // join a periodic piece that wraps through 0 / 360
  for (const sh of SHAPES.filter((q) => q.periodic)) {
    const ps = out.filter((p) => p.shape === sh);
    const first = ps.find((p) => p.s0 <= sh.s0 + 1e-9), last = ps.find((p) => p.s1 >= sh.s1 - 2 * sh.step);
    if (first && last && first !== last && first.sign === last.sign) {
      first.s0 = last.s0 - 360;
      out.splice(out.indexOf(last), 1);
    }
  }
  return out;
}

export function widest(pieces: Piece[]): Piece | null {
  return pieces.reduce<Piece | null>((m, p) => (!m || p.s1 - p.s0 > m.s1 - m.s0 ? p : m), null);
}

/** how a section point becomes a model initial state (see App: "IC mapping") */
export interface SectionOpts {
  z: number; // out-of-plane offset of the section point [ndim]; the boundaries are cylinders
  psi3: number; // velocity elevation above the Earth-Moon plane [deg]
  kappa: number; // speed^2 = kappa * 2U - C  (1 = CR3BP Jacobi; p/l0 = model's Jacobi-like value)
  vscale: number; // extra factor on the velocity (1/k = same pulsating numbers as CR3BP)
}
export const PLANAR: SectionOpts = { z: 0, psi3: 0, kappa: 1, vscale: 1 };

/** section state on the source side of the boundary, or null if forbidden */
export function sectionStateOn(pc: Piece, s: number, psi2: number, C: number, o: SectionOpts = PLANAR): State | null {
  const [x0, y0] = pc.shape.pt(s), [nx, ny] = pc.shape.nrm(s), e = 1e-9 * pc.sign;
  const x = x0 - e * nx, y = y0 - e * ny, z = o.z;
  const v2 = o.kappa * twoU(x, y, z) - C;
  if (!(v2 > 0)) return null;
  const v = Math.sqrt(v2) * o.vscale, a = psi2 * D2R, f = o.psi3 * D2R;
  return [x, y, z, v * Math.cos(f) * Math.cos(a), v * Math.cos(f) * Math.sin(a), v * Math.sin(f)];
}

/** velocity angle psi2 points into the target region */
export function intoTarget(pc: Piece, s: number, psi2: number): boolean {
  const [nx, ny] = pc.shape.nrm(s), a = psi2 * D2R;
  return pc.sign * (Math.cos(a) * nx + Math.sin(a) * ny) > 0;
}

export interface Window { p1a: number; p1b: number; p2a: number; p2b: number }
const r2 = (v: number) => Math.round(v * 1e4) / 1e4;

/** whole piece and the velocity directions pointing into the target */
export function pieceWindow(pc: Piece): Window {
  const mids = [pc.s0, 0.5 * (pc.s0 + pc.s1), pc.s1].map((s) => {
    const [nx, ny] = pc.shape.nrm(s);
    return Math.atan2(pc.sign * ny, pc.sign * nx) / D2R;
  });
  // spread of the normal along the piece (curved boundaries)
  let lo = mids[1], hi = mids[1];
  for (const m of mids) {
    let d = m - mids[1];
    d -= 360 * Math.round(d / 360);
    lo = Math.min(lo, mids[1] + d); hi = Math.max(hi, mids[1] + d);
  }
  let p2a = lo - 90, p2b = hi + 90;
  if (p2a < 0) { p2a += 360; p2b += 360; }
  return { p1a: r2(pc.s0), p1b: r2(pc.s1), p2a: r2(p2a), p2b: r2(p2b) };
}

export const fmtS = (pc: Piece, s: number) => (pc.shape.unit === 'deg' ? `${s.toFixed(1)}°` : s.toFixed(3));
