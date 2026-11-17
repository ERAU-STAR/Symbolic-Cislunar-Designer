// Boundary section on the lunar ellipse for an entry edge src -> tgt.
// Grid states follow the maps: x = 1-mu + (a*+1e-9) cos psi1, y = (b*+1e-9) sin psi1,
// speed from C, velocity angle psi2; only inward velocities are sampled.
import { A_STAR, B_STAR, X_MOON, twoU } from './constants';
import { classify } from './partition';
import type { State } from './cr3bp';

const D2R = Math.PI / 180;
const EPS = 1e-9;

export function sectionState(psi1: number, psi2: number, C: number): State | null {
  const p1 = psi1 * D2R, p2 = psi2 * D2R;
  const x = X_MOON + (A_STAR + EPS) * Math.cos(p1), y = (B_STAR + EPS) * Math.sin(p1);
  const v2 = twoU(x, y) - C;
  if (!(v2 > 0)) return null;
  const v = Math.sqrt(v2);
  return [x, y, 0, v * Math.cos(p2), v * Math.sin(p2), 0];
}

/** true if psi2 points into the ellipse at psi1 */
export function inward(psi1: number, psi2: number): boolean {
  const p1 = psi1 * D2R, p2 = psi2 * D2R;
  return (Math.cos(p2) * Math.cos(p1)) / A_STAR + (Math.sin(p2) * Math.sin(p1)) / B_STAR < 0;
}

export interface Window { p1a: number; p1b: number; p2a: number; p2b: number }

/** psi1 intervals [deg] where the ellipse separates src (outside) from tgt (inside) and is accessible */
export function edgeArcs(src: number, tgt: number, C: number, step = 0.05): [number, number][] {
  const arcs: [number, number][] = [];
  let start: number | null = null;
  const n = Math.round(360 / step);
  const ok = (deg: number) => {
    const p = deg * D2R;
    const xo = X_MOON + (A_STAR + 1e-6) * Math.cos(p), yo = (B_STAR + 1e-6) * Math.sin(p);
    const xi = X_MOON + (A_STAR - 1e-6) * Math.cos(p), yi = (B_STAR - 1e-6) * Math.sin(p);
    return classify(xo, yo, C) === src && classify(xi, yi, C) === tgt && twoU(xo, yo) > C;
  };
  for (let k = 0; k <= n; k++) {
    const d = k * step;
    const good = k < n && ok(d);
    if (good && start === null) start = d;
    if (!good && start !== null) { arcs.push([start, d - step]); start = null; }
  }
  // merge wrap-around (arc through 0/360)
  if (arcs.length > 1 && arcs[0][0] === 0 && Math.abs(arcs[arcs.length - 1][1] - (360 - step)) < 1e-9) {
    const last = arcs.pop()!;
    arcs[0] = [last[0] - 360, arcs[0][1]];
  }
  return arcs;
}

/** default window: the widest arc and the inward velocity directions over it */
export function defaultWindow(src: number, tgt: number, C: number): Window | null {
  const arcs = edgeArcs(src, tgt, C);
  if (!arcs.length) return null;
  const [a, b] = arcs.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m));
  // inward directions: centred on the inward normal, +-90 deg
  const mid = 0.5 * (a + b) * D2R;
  const nIn = Math.atan2(-Math.sin(mid) / B_STAR, -Math.cos(mid) / A_STAR) / D2R;
  const half = 90 + 0.5 * (b - a);
  let p2a = nIn - half, p2b = nIn + half;
  if (p2a < 0) { p2a += 360; p2b += 360; }
  return { p1a: round(a), p1b: round(b), p2a: round(p2a), p2b: round(p2b) };
}
const round = (v: number) => Math.round(v * 100) / 100;
