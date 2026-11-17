// Fine alphabet, colours, graph layout and the nested graph family G(1)..G(9).
// Region ids follow classify_region in cr3bp_symbolic_word / make_true_symbolic_examples_v9.

export const ID = {
  XL: 1, XT: 2, XB: 3, ET: 4, EC: 5, EB: 6, ER: 7,
  ML: 8, MT1: 9, MT2: 10, MC: 11, MB1: 12, MB2: 13, MR: 14,
} as const;

export const NAMES: Record<number, string> = {
  1: 'X_L', 2: 'X_T', 3: 'X_B', 4: 'E_T', 5: 'E_C', 6: 'E_B', 7: 'E_R',
  8: 'M_L', 9: 'M_T1', 10: 'M_T2', 11: 'M_C', 12: 'M_B1', 13: 'M_B2', 14: 'M_R',
};
export const ALL_IDS = Object.keys(NAMES).map(Number);

/** coarse lunar alphabet used in the paper's section maps */
export const COARSE: Record<number, string> = {
  ...NAMES, 9: 'M_1', 12: 'M_1', 10: 'M_2', 13: 'M_2',
};

export const isLunar = (id: number) => id >= 8 && id <= 14;
export const isEarthSide = (id: number) => id >= 4 && id <= 7;
export const isExterior = (id: number) => id >= 1 && id <= 3;

// Region colours (make_true_symbolic_examples_v9 symbolic_region_colormap)
export const COLORS: Record<number, [number, number, number]> = {
  1: [0.96, 0.88, 0.3], 2: [1.0, 0.95, 0.65], 3: [0.88, 0.72, 0.05],
  4: [1.0, 0.78, 0.78], 5: [0.35, 0.0, 0.0], 6: [0.95, 0.6, 0.6], 7: [0.85, 0.2, 0.2],
  8: [0.72, 0.84, 1.0], 9: [0.52, 0.72, 1.0], 10: [0.28, 0.58, 0.96], 11: [0.55, 0.55, 0.55],
  12: [0.43, 0.68, 0.96], 13: [0.18, 0.52, 0.9], 14: [0.0, 0.36, 0.78],
};
export const css = (c: readonly number[], a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
export const textOn = (c: readonly number[]) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.48 ? '#fff' : '#111';

// Graph node layout (graph_region_zvc_connection_analysis_v13 symbolic_graph_positions)
export const NODE_POS: Record<number, [number, number]> = {
  1: [-2.5, 0], 2: [1.35, 2.15], 3: [1.35, -2.15], 4: [-1.45, 0.9], 5: [-0.75, 0],
  6: [-1.45, -0.9], 7: [0.2, 0], 8: [1.15, 0], 9: [2.0, 1.0], 10: [3.0, 1.0],
  11: [2.5, 0], 12: [2.0, -1.0], 13: [3.0, -1.0], 14: [3.85, 0],
};

const I = ID;
/** reciprocal edge pairs first activated in regime k (Table 1) */
export const EDGES_BY_REGIME: [number, number][][] = [
  [
    [I.XL, I.XT], [I.XL, I.XB], [I.XT, I.XB], [I.ET, I.EB], [I.ET, I.EC], [I.ET, I.ER],
    [I.EB, I.EC], [I.EB, I.ER], [I.EC, I.ER], [I.MT1, I.MT2], [I.MT1, I.MB1], [I.MT1, I.MC],
    [I.MB1, I.MC], [I.MB1, I.MB2], [I.MT2, I.MB2], [I.MT2, I.MC], [I.MB2, I.MC],
  ],
  [[I.ER, I.ML], [I.ML, I.MT1], [I.ML, I.MB1]],
  [[I.MR, I.MT2], [I.MR, I.MB2], [I.MR, I.XT], [I.MR, I.XB]],
  [[I.XT, I.MT2], [I.XB, I.MB2]],
  [[I.XT, I.MT1], [I.XB, I.MB1]],
  [[I.ER, I.MT1], [I.ER, I.MB1]],
  [[I.XL, I.ET], [I.XL, I.EB]],
  [[I.ER, I.XT], [I.ER, I.XB]],
  [[I.ET, I.XT], [I.EB, I.XB]],
];
export const NODE_REGIME: Record<number, number> = Object.fromEntries(
  ALL_IDS.map((i) => [i, i === I.ML ? 2 : i === I.MR ? 3 : 1]),
);

export interface GraphState {
  regime: number;
  active: Set<number>;
  edges: { a: number; b: number; k: number }[];
  adj: Map<number, Set<number>>;
}

export function graphAt(regime: number): GraphState {
  const active = new Set(ALL_IDS.filter((i) => NODE_REGIME[i] <= regime));
  const edges: GraphState['edges'] = [];
  const adj = new Map<number, Set<number>>();
  ALL_IDS.forEach((i) => adj.set(i, new Set()));
  EDGES_BY_REGIME.forEach((list, k0) => {
    if (k0 + 1 > regime) return;
    for (const [a, b] of list) {
      if (!active.has(a) || !active.has(b)) continue;
      edges.push({ a, b, k: k0 + 1 });
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  });
  return { regime, active, edges, adj };
}

/** edges that cross the lunar ellipse (outside -> lunar): v1 section edges */
export function isEntryEdge(src: number, tgt: number) {
  return !isLunar(src) && isLunar(tgt) && tgt !== ID.MC;
}

export const REGIME_COLORS = [
  [0.1, 0.1, 0.1], [0.85, 0.1, 0.1], [0.95, 0.45, 0.05], [0.85, 0.65, 0.0], [0.1, 0.6, 0.25],
  [0.2, 0.72, 0.88], [0.05, 0.3, 0.85], [0.48, 0.2, 0.72], [0.9, 0.25, 0.6],
];
