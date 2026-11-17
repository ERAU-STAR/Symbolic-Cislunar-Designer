// Colours for map classes (terminal-family hues, shaded by rank) and match mode.
import { classWord, matchLength, wordNames } from '../core/words';
import type { PointResult } from '../core/mapEngine';

export type Mode = 'match' | 'classes';
/** class colouring: distinct categorical colours, hue by early branch (first symbols), or family by the last symbol */
export type Scheme = 'distinct' | 'branch' | 'ending';
type RGB = [number, number, number];
export const FORBIDDEN_RGB: [number, number, number] = [255, 255, 255];
export const OUTGOING_RGB: [number, number, number] = [233, 229, 245];

const FAMILY: [RegExp, [number, number, number]][] = [
  [/E_C\*$/, [90, 0, 0]],
  [/E_\w+$/, [217, 51, 51]],
  [/M_C\*$/, [140, 140, 140]],
  [/M_\*$/, [51, 128, 235]],
  [/X_\w+$/, [224, 184, 13]],
];
function family(word: string): RGB {
  for (const [re, c] of FAMILY) if (re.test(word)) return c;
  return [150, 90, 180];
}
function shade(c: [number, number, number], s: number): [number, number, number] {
  return s < 0
    ? (c.map((v) => v + (255 - v) * -s) as [number, number, number])
    : (c.map((v) => v * (1 - 0.6 * s)) as [number, number, number]);
}

const SHADES = [0, -0.4, 0.4, -0.65, 0.6, -0.2, 0.2, -0.5, 0.5, -0.3, 0.3];

// Categorical colours (Tableau-20 order without its greys, then darker / brighter extras); greys are left
// for "Other" and the Moon-impact family, white / lavender for forbidden / outgoing.
const DISTINCT: RGB[] = [
  [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75], [227, 119, 194], [188, 189, 34], [23, 190, 207],
  [174, 199, 232], [255, 187, 120], [152, 223, 138], [255, 152, 150], [197, 176, 213], [196, 156, 148], [247, 182, 210], [219, 219, 141], [158, 218, 229],
  [0, 0, 128], [128, 0, 0], [0, 100, 0], [255, 215, 0], [128, 128, 0], [255, 0, 255], [0, 128, 128], [255, 99, 71],
];
/** colour number n beyond the table: golden-angle hues with alternating lightness */
function extra(n: number): RGB {
  const h = (n * 137.508) % 360, l = [0.45, 0.65, 0.32, 0.75][n % 4], sat = 0.65;
  const f = (k: number) => { const a = (k + h / 30) % 12; return l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(a - 3, 9 - a, 1)); };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as RGB;
}
const nth = (n: number): RGB => (n < DISTINCT.length ? DISTINCT[n] : extra(n));

// session registries: a class keeps its colour across maps, models and epochs
const REG: Record<Scheme, Map<string, RGB>> = { distinct: new Map(), branch: new Map(), ending: new Map() };
const FAM_N = new Map<string, number>();
const BR_HUE = new Map<string, RGB>();
const BR_N = new Map<string, number>();
const BRANCH_HUES: RGB[] = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75], [227, 119, 194], [188, 189, 34], [23, 190, 207], [0, 0, 128], [128, 0, 0], [0, 100, 0]];
export const BRANCH_DEPTH = 4; // section source + target + the next two symbols
export function branchOf(w: string, depth = BRANCH_DEPTH) {
  const t = w.replace(' …', '').split(' ');
  return t.slice(0, depth).join(' ');
}
function stableColor(w: string, scheme: Scheme, branchDepth = BRANCH_DEPTH): RGB {
  const reg = REG[scheme];
  let c = reg.get(w);
  if (c) return c;
  if (scheme === 'distinct') c = nth(reg.size);
  else if (scheme === 'branch') {
    const b = branchOf(w, branchDepth);
    let base = BR_HUE.get(b);
    if (!base) { base = BRANCH_HUES[BR_HUE.size % BRANCH_HUES.length]; if (BR_HUE.size >= BRANCH_HUES.length) base = extra(BR_HUE.size); BR_HUE.set(b, base); }
    const n = BR_N.get(b) ?? 0; BR_N.set(b, n + 1);
    c = shade(base, SHADES[n % SHADES.length]);
  } else {
    const base = family(w), key = base.join();
    const n = FAM_N.get(key) ?? 0;
    FAM_N.set(key, n + 1);
    c = shade(base, SHADES[n % SHADES.length]);
  }
  reg.set(w, c);
  return c;
}

export interface Legend {
  entries: { key: string; label: string; rgb: [number, number, number]; count: number; sub?: boolean }[];
  colorOf: (r: PointResult) => [number, number, number];
  keyOf: (r: PointResult) => string; // class / match key of a point (also the legend key)
  isOn: (r: PointResult) => boolean; // false when another legend entry is highlighted
}
export interface LegendOpts {
  maxClasses: number; // classes with their own colour; the rest are "Other"
  depth: number; // 0 = whole class word, n = group by the first n symbols
  highlight: string | null; // legend key to show alone (others faded)
  scheme?: Scheme;
  /** class word of a point (default: the paper's class word); the dv map uses the post-burn word */
  wordOf?: (tokens: number[], status: number, coarse: boolean) => string;
}
export const OTHER = '__other';
const fade = (c: [number, number, number]): [number, number, number] => [c[0] * 0.18 + 209, c[1] * 0.18 + 209, c[2] * 0.18 + 209];

const memo = new WeakMap<PointResult, Map<string, string>>();
function cached(r: PointResult, k: string, f: () => string) {
  let m = memo.get(r);
  if (!m) memo.set(r, (m = new Map()));
  let v = m.get(k);
  if (v === undefined) m.set(k, (v = f()));
  return v;
}

export function buildLegend(results: PointResult[], counts: Map<PointResult, number>, mode: Mode, coarse: boolean, user: number[], userB: number[] = [],
  o: LegendOpts = { maxClasses: 15, depth: 0, highlight: null }): Legend {
  const { maxClasses, depth, highlight } = o;
  const scheme = o.scheme ?? 'distinct';
  const bd = depth ? Math.min(depth, BRANCH_DEPTH) : BRANCH_DEPTH;
  const fLen = wordNames(user, coarse).length;
  const bLen = userB.length > 1 ? wordNames(userB, coarse).length - 1 : 0; // source region is shared
  const userLen = fLen + bLen;
  const keyOf = (r: PointResult): string => {
    if (r.kind !== 'traj') return r.kind;
    const t = Array.from(r.tokens!);
    if (mode === 'classes') return cached(r, `c${+coarse}d${depth}${o.wordOf ? 'w' : ''}`, () => {
      const w = o.wordOf ? o.wordOf(t, r.status!, coarse) : classWord(t, r.status!, coarse);
      if (!depth) return w;
      const tk = w.split(' ');
      return tk.length > depth ? tk.slice(0, depth).join(' ') + ' …' : w;
    });
    return cached(r, 'm' + +coarse, () => {
      const mf = matchLength(t, user, coarse);
      const mb = bLen ? Math.max(0, matchLength(Array.from(r.btokens ?? []), userB, coarse) - 1) : 0;
      const m = mf + mb;
      if (m < userLen) return `partial:${m}`;
      const names = wordNames(t, coarse);
      const next = names[fLen];
      if (next) return `match → ${next}`;
      return r.status === 1 ? 'match → M_C*' : r.status === 2 ? 'match → E_C*' : 'match (word ends at horizon)';
    });
  };
  const tally = new Map<string, number>();
  for (const r of results) { const k = keyOf(r); tally.set(k, (tally.get(k) ?? 0) + (counts.get(r) ?? 1)); }
  const colors = new Map<string, [number, number, number]>();
  const otherSet = new Set<string>();
  const entries: Legend['entries'] = [];
  if (mode === 'classes') {
    const words = [...tally.entries()].filter(([k]) => k !== 'forbidden' && k !== 'outgoing').sort((a, b) => b[1] - a[1]);
    const top = words.slice(0, maxClasses), rest = words.slice(maxClasses);
    // colours stay fixed per class word for the whole session, so maps of different
    // models / epochs can be compared directly
    for (const [w] of top) colors.set(w, stableColor(w, scheme, bd));
    for (const [w, n] of top) entries.push({ key: w, label: w, rgb: colors.get(w)!, count: n });
    if (rest.length) {
      const n = rest.reduce((s, [, c]) => s + c, 0);
      entries.push({ key: OTHER, label: `Other (${rest.length} classes)`, rgb: [60, 60, 80], count: n });
      for (const [w] of rest) { colors.set(w, [60, 60, 80]); otherSet.add(w); }
      // "Other" opened: give each of its classes its own colour and list them
      if (highlight === OTHER) for (const [w, c] of rest) {
        colors.set(w, stableColor(w, scheme, bd));
        entries.push({ key: w, label: w, rgb: colors.get(w)!, count: c, sub: true });
      }
    }
  } else {
    const matches = [...tally.entries()].filter(([k]) => k.startsWith('match')).sort((a, b) => b[1] - a[1]);
    const hues: [number, number, number][] = [[22, 163, 74], [37, 99, 235], [234, 88, 12], [147, 51, 234], [8, 145, 178], [190, 18, 60], [101, 163, 13]];
    matches.forEach(([k, n], q) => { const c = hues[q % hues.length]; colors.set(k, c); entries.push({ key: k, label: k, rgb: c, count: n }); });
    for (let m = userLen - 1; m >= 0; m--) {
      const k = `partial:${m}`, n = tally.get(k);
      const g = Math.round(150 + (105 * (userLen - 1 - m)) / Math.max(1, userLen - 1)) - 20;
      colors.set(k, [g, g, g]);
      if (n) entries.push({ key: k, label: m === 0 ? 'no match' : `${m} of ${userLen} symbols matched`, rgb: [g, g, g], count: n });
    }
  }
  const out = tally.get('outgoing');
  if (out) entries.push({ key: 'outgoing', label: 'outgoing velocity (not sampled)', rgb: OUTGOING_RGB, count: out });
  const fb = tally.get('forbidden');
  if (fb) entries.push({ key: 'forbidden', label: 'forbidden (C)', rgb: FORBIDDEN_RGB, count: fb });
  const base = (r: PointResult) => (r.kind === 'forbidden' ? FORBIDDEN_RGB : r.kind === 'outgoing' ? OUTGOING_RGB : colors.get(keyOf(r)) ?? [60, 60, 80]);
  const isOn = (r: PointResult) => {
    if (!highlight) return true;
    if (r.kind !== 'traj') return false;
    const k = keyOf(r);
    return highlight === OTHER ? otherSet.has(k) : k === highlight;
  };
  return {
    entries,
    keyOf,
    isOn,
    colorOf: (r) => {
      const c = base(r);
      if (!highlight || r.kind !== 'traj') return c;
      return isOn(r) ? c : fade(c);
    },
  };
}
