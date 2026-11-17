// Point classifier (identical to classify_region in cr3bp_symbolic_word / the
// Bayesian code) and the display raster with the graph_region_v7 rules.
import {
  MU, X_EARTH, X_MOON, R_EARTH, R_MOON, A_STAR, B_STAR, X_L1, X_L2, C_L1, C_L2,
  X_G, R_G, WEDGE_SLOPE, EXTERIOR_SPLIT_X, twoU,
} from './constants';
import { ID } from './symbols';

function outsideMoon(x: number, y: number): number {
  if ((x - X_G) ** 2 + y * y <= R_G * R_G) {
    if (x >= X_EARTH && y >= -WEDGE_SLOPE * (x - X_EARTH) && y <= WEDGE_SLOPE * (x - X_EARTH)) return ID.ER;
    return y >= 0 ? ID.ET : ID.EB;
  }
  if (x < EXTERIOR_SPLIT_X) return ID.XL;
  return y >= 0 ? ID.XT : ID.XB;
}

/** fine region id of a point for Jacobi constant C (trajectory word encoder) */
export function classify(x: number, y: number, C: number): number {
  if (Math.hypot(x - X_EARTH, y) <= R_EARTH) return ID.EC;
  if (Math.hypot(x - X_MOON, y) <= R_MOON) return ID.MC;
  if (((x - X_MOON) / A_STAR) ** 2 + (y / B_STAR) ** 2 <= 1) {
    let id: number;
    if (x < X_L1) id = ID.ML;
    else if (x > X_L2) id = ID.MR;
    else if (x < X_MOON && y >= 0) id = ID.MT1;
    else if (y >= 0) id = ID.MT2;
    else if (x < X_MOON) id = ID.MB1;
    else id = ID.MB2;
    if ((id === ID.ML && C > C_L1) || (id === ID.MR && C > C_L2)) return outsideMoon(x, y);
    return id;
  }
  return outsideMoon(x, y);
}

export interface View { x0: number; x1: number; y0: number; y1: number }
export interface Raster {
  nx: number; ny: number; view: View;
  label: Uint8Array; // display label, 0 = forbidden
  w: Float32Array; // 2U* (for ZVC contours)
}

/**
 * Display raster: v7 graph_region_map_xy + relabel_closed_gateway_caps +
 * merge_disconnected_lunar_fragments, then forbidden (2U* < C) cleared.
 * Row 0 is y = view.y0.
 */
export function regionRaster(view: View, nx: number, ny: number, C: number): Raster {
  const label = new Uint8Array(nx * ny);
  const w = new Float32Array(nx * ny);
  const dx = (view.x1 - view.x0) / (nx - 1);
  const dy = (view.y1 - view.y0) / (ny - 1);
  for (let j = 0; j < ny; j++) {
    const y = view.y0 + j * dy;
    for (let i = 0; i < nx; i++) {
      const x = view.x0 + i * dx;
      const k = j * nx + i;
      label[k] = classify(x, y, C);
      w[k] = twoU(x, y);
    }
  }
  // merge detached fragments of the four central lunar quadrants
  const rules: [number, number, boolean][] = [
    [ID.MT1, ID.MT2, true], [ID.MT2, ID.MT1, true], [ID.MB1, ID.MB2, false], [ID.MB2, ID.MB1, false],
  ];
  const orig = label.slice();
  for (const [src, nbr, upper] of rules) {
    const mask = new Uint8Array(nx * ny);
    let n = 0;
    let yExt = upper ? Infinity : -Infinity;
    for (let k = 0; k < mask.length; k++) {
      if (orig[k] === src && w[k] >= C) {
        mask[k] = 1; n++;
        const yk = view.y0 + Math.floor(k / nx) * dy;
        yExt = upper ? Math.min(yExt, yk) : Math.max(yExt, yk);
      }
    }
    if (n < 2) continue;
    const reached = new Uint8Array(nx * ny);
    const stack: number[] = [];
    for (let k = 0; k < mask.length; k++) {
      if (!mask[k]) continue;
      const yk = view.y0 + Math.floor(k / nx) * dy;
      if (upper ? yk <= yExt + 1.5 * dy : yk >= yExt - 1.5 * dy) { reached[k] = 1; stack.push(k); }
    }
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % nx, j = (k - i) / nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !reached[q]) { reached[q] = 1; stack.push(q); }
    }
    for (let k = 0; k < mask.length; k++) if (mask[k] && !reached[k]) label[k] = nbr;
  }
  for (let k = 0; k < label.length; k++) if (w[k] < C) label[k] = 0;
  return { nx, ny, view, label, w };
}

/** which regions have an accessible (nonempty) part at C, from a raster */
export function activeLabels(r: Raster): Set<number> {
  const s = new Set<number>();
  for (let k = 0; k < r.label.length; k++) if (r.label[k]) s.add(r.label[k]);
  return s;
}

export { MU };
