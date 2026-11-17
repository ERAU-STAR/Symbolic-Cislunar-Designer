// Earth-Moon CR3BP constants and the geometry of the symbolic partition
// (AAS 27-530, Jo, Sahin & Canales; graph_region_v7 / make_true_symbolic_examples_v9).

export const MU = 0.012153663111117432;
export const X_EARTH = -MU;
export const X_MOON = 1 - MU;
export const R_EARTH = 6378.137 / 384399; // planar E_C radius [ndim]
export const R_MOON = 1737.4 / 384399; // planar M_C radius [ndim]
export const A_STAR = 0.3275; // lunar ellipse semi-axes
export const B_STAR = 0.4945;
export const LSTAR_KM = 384399;
export const TSTAR_DAYS = 2360592 / (2 * Math.PI) / 86400; // 1 TU in days (~4.348 d)

/** 2U*(x,y,0) = x^2+y^2+2(1-mu)/r1+2mu/r2 ; the ZVC is 2U* = C. */
export function twoU(x: number, y: number, z = 0): number {
  const r1 = Math.sqrt((x + MU) ** 2 + y * y + z * z);
  const r2 = Math.sqrt((x - 1 + MU) ** 2 + y * y + z * z);
  return x * x + y * y + (2 * (1 - MU)) / r1 + (2 * MU) / r2;
}

function collinear(lo: number, hi: number): number {
  // root of dU/dx on the x axis, bisection then Newton polish
  const f = (x: number) =>
    x - ((1 - MU) * (x + MU)) / Math.abs(x + MU) ** 3 - (MU * (x - 1 + MU)) / Math.abs(x - 1 + MU) ** 3;
  let a = lo,
    b = hi;
  for (let k = 0; k < 200; k++) {
    const m = 0.5 * (a + b);
    if (f(a) * f(m) <= 0) b = m;
    else a = m;
  }
  return 0.5 * (a + b);
}

export const X_L1 = collinear(X_EARTH + 1e-6, X_MOON - 1e-6);
export const X_L2 = collinear(X_MOON + 1e-6, 2);
export const X_L3 = collinear(-2, X_EARTH - 1e-6);
export const L4 = [0.5 - MU, Math.sqrt(3) / 2] as const;
export const C_L1 = twoU(X_L1, 0);
export const C_L2 = twoU(X_L2, 0);
export const C_L3 = twoU(X_L3, 0);

// Earth-side / exterior separator: circle through L3, L4, L5
export const X_G = (L4[0] ** 2 + L4[1] ** 2 - X_L3 ** 2) / (2 * (L4[0] - X_L3));
export const R_G = Math.abs(X_L3 - X_G);
export const WEDGE_SLOPE = L4[1] / (L4[0] - X_EARTH); // Earth->L4 ray (E_R wedge)
export const EXTERIOR_SPLIT_X = 0; // X_L | X_T/X_B split

// Graph regimes (Table 1; graph_region_zvc_connection_analysis_v13). Equality
// belongs to the newly activated lower-C regime.
export const REGIME_THRESHOLDS = [C_L1, C_L2, 3.13711, 3.029583, 3.012508, C_L3, 3.00485, 2.992784];
export function regimeIndex(C: number): number {
  let k = 1;
  for (const t of REGIME_THRESHOLDS) {
    if (C > t) return k;
    k++;
  }
  return 9;
}
