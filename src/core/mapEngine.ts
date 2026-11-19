// Adaptive symbolic map on a dyadic grid: coarse lattice first, then only the
// blocks whose corners disagree (plus their neighbours) are subdivided.
import { sectionStateOn, intoTarget, type Window, type Piece, type SectionOpts } from './boundary';
import { classWord, matchLength } from './words';
import type { JobMsg, JobResult, InitMsg } from './worker';
import type { ModelParams } from './models';
import { cacheGet, cachePut } from './cache';

export const ENGINE_VERSION = 'models-dop853-v5';

export interface MapParams {
  C: number;
  tEnd: number; // TU
  user: number[]; // forward word from the section's source region
  userB: number[]; // backward word (reversed, starts with the source region); [] = none
  piece: Piece;
  sopt: SectionOpts;
  /** grid axes: 'spsi' = (s, psi2) at fixed z, psi3 (sopt); 'zpsi3' = (z, psi3) at fixed s, psi2 */
  axes: 'spsi' | 'zpsi3';
  fixed: { s: number; psi2: number };
  win: Window;
  base: number; // coarse cells per axis
  levels: number; // refinements; final points per axis = base*2^levels+1
  model: ModelParams;
  modelKey: string; // e.g. "qhr4bp_ecc@2459912.26" (part of the cache key)
  /** maps that do not start on a section (the dv map): grid point -> model state at model time t0 */
  custom?: CustomMap;
  /** short-lived maps (the fine-tune mini map): no device cache */
  noCache?: boolean;
}
export interface CustomMap {
  key: string; // identifies the map in the cache
  state(u: number, v: number): { y: number[]; C: number } | null;
  t0: number; // [tau]
  stride: number; // model state length
  maxSym: number; // stop after this many symbols past the start
  prefix: number[]; // tokens before the start (prepended to every result)
}

export const enum Kind { Pending = -2, None = -1 }
export const FORBIDDEN = 0, OUTGOING = 1; // special result kinds

export interface PointResult {
  kind: 'traj' | 'forbidden' | 'outgoing';
  tokens?: Int8Array;
  times?: Float32Array;
  status?: number;
  tEnd?: number;
  btokens?: Int8Array;
  bstatus?: number;
}

export interface MapState {
  p: MapParams;
  n1: number;
  n2: number;
  psi1: Float64Array;
  psi2: Float64Array;
  src: Int32Array; // grid point -> index of the computed point that represents it
  res: Map<number, PointResult>;
  level: number; // last completed level
  computed: number;
  done: boolean;
}

export function newState(p: MapParams): MapState {
  const n = p.base * 2 ** p.levels + 1;
  const psi1 = new Float64Array(n), psi2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    psi1[i] = p.win.p1a + ((p.win.p1b - p.win.p1a) * i) / (n - 1);
    psi2[i] = p.win.p2a + ((p.win.p2b - p.win.p2a) * i) / (n - 1);
  }
  return { p, n1: n, n2: n, psi1, psi2, src: new Int32Array(n * n).fill(Kind.None), res: new Map(), level: -1, computed: 0, done: false };
}

/** refinement key: fine class word + fine match length (so both class and match boundaries refine) */
const keyMemo = new WeakMap<PointResult, string>();
export function refineKey(r: PointResult, user: number[], userB: number[] = [], full = false): string {
  let k = keyMemo.get(r);
  if (k) return k;
  if (r.kind !== 'traj') k = r.kind;
  else if (full) k = Array.from(r.tokens!).join(',') + '|' + r.status;
  else {
    const t = Array.from(r.tokens!);
    k = classWord(t, r.status!, false) + '|' + matchLength(t, user, false);
    if (userB.length > 1) k += '|' + matchLength(Array.from(r.btokens ?? []), userB, false);
  }
  keyMemo.set(r, k);
  return k;
}

// ------------------------------------------------------------------ workers
class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { msg: JobMsg; resolve: (r: JobResult) => void }[] = [];
  private seq = 0;
  private modelId = 0;
  private modelKey = '';
  /** send the model to every worker (once per model); returns its id */
  setModel(key: string, model: ModelParams): number {
    if (key !== this.modelKey) {
      this.modelKey = key;
      this.modelId++;
      const msg: InitMsg = { type: 'init', modelId: this.modelId, model };
      for (const w of this.workers) w.postMessage(msg);
    }
    return this.modelId;
  }
  constructor(n: number) {
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  get size() { return this.workers.length; }
  run(msg: Omit<JobMsg, 'id' | 'type'>): Promise<JobResult> {
    return new Promise((resolve) => {
      this.queue.push({ msg: { ...msg, type: 'job', id: ++this.seq }, resolve });
      this.pump();
    });
  }
  cancelQueued() { this.queue.length = 0; }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      w.onmessage = (ev: MessageEvent<JobResult>) => {
        this.idle.push(w);
        job.resolve(ev.data);
        this.pump();
      };
      w.postMessage(job.msg, [job.msg.states.buffer]);
    }
  }
}
let pool: Pool | null = null;
export function workerCount() {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(16, hc - 1));
}
function getPool() { return (pool ??= new Pool(workerCount())); }

// ------------------------------------------------------------------ cache
/** section state of grid point (u, v) for either axis choice */
export function stateAt(p: MapParams, u: number, v: number) {
  if (p.custom) return p.custom.state(u, v)?.y ?? null;
  return p.axes === 'zpsi3'
    ? sectionStateOn(p.piece, p.fixed.s, p.fixed.psi2, p.C, { ...p.sopt, z: u, psi3: v })
    : sectionStateOn(p.piece, u, v, p.C, p.sopt);
}
function inwardAt(p: MapParams, u: number, v: number) {
  if (p.custom) return true;
  return p.axes === 'zpsi3' ? intoTarget(p.piece, p.fixed.s, p.fixed.psi2) : intoTarget(p.piece, u, v);
}

export function cacheKey(p: MapParams) {
  if (p.custom) return JSON.stringify([ENGINE_VERSION, 'custom', p.custom.key, p.modelKey, +p.tEnd.toFixed(4), p.custom.maxSym, p.win, p.base, p.levels]);
  return JSON.stringify([ENGINE_VERSION, p.modelKey, +p.C.toFixed(6), +p.tEnd.toFixed(4), p.user, p.userB, p.piece.shape.id, p.piece.sign, p.sopt, p.axes, p.axes === 'zpsi3' ? p.fixed : null, p.win, p.base, p.levels]);
}
interface Stored {
  level: number;
  src: Int32Array;
  idx: Int32Array;
  kind: Uint8Array; // 0 traj 1 forbidden 2 outgoing
  status: Uint8Array;
  tEnd: Float32Array;
  tok: Int8Array[];
  tim: Float32Array[];
  btok: Int8Array[];
  bst: Uint8Array;
}
function pack(s: MapState): Stored {
  const idx = Int32Array.from(s.res.keys());
  const n = idx.length;
  const out: Stored = { level: s.level, src: s.src.slice(), idx, kind: new Uint8Array(n), status: new Uint8Array(n), tEnd: new Float32Array(n), tok: [], tim: [], btok: [], bst: new Uint8Array(n) };
  idx.forEach((k, q) => {
    const r = s.res.get(k)!;
    out.kind[q] = r.kind === 'traj' ? 0 : r.kind === 'forbidden' ? 1 : 2;
    out.status[q] = r.status ?? 0;
    out.tEnd[q] = r.tEnd ?? 0;
    out.tok.push(r.tokens ?? new Int8Array());
    out.tim.push(r.times ?? new Float32Array());
    out.btok.push(r.btokens ?? new Int8Array());
    out.bst[q] = r.bstatus ?? 0;
  });
  return out;
}
function unpack(s: MapState, d: Stored) {
  s.src.set(d.src);
  s.level = d.level;
  d.idx.forEach((k, q) => {
    const kind = d.kind[q] === 0 ? 'traj' : d.kind[q] === 1 ? 'forbidden' : 'outgoing';
    s.res.set(k, kind === 'traj' ? { kind, tokens: d.tok[q], times: d.tim[q], status: d.status[q], tEnd: d.tEnd[q], btokens: d.btok?.[q], bstatus: d.bst?.[q] } : { kind });
  });
  s.computed = s.res.size;
}

// ------------------------------------------------------------------ driver
export interface RunHandle { cancel(): void; promise: Promise<MapState> }

export function runMap(p: MapParams, onUpdate: (s: MapState, msg: string) => void): RunHandle {
  let cancelled = false;
  const s = newState(p);
  const key = cacheKey(p);
  const promise = (async () => {
    const stored = p.noCache ? null : await cacheGet<Stored>(key);
    if (stored && stored.src?.length === s.src.length) {
      unpack(s, stored);
      onUpdate(s, `restored ${s.computed} points from the device cache`);
    }
    const S = 2 ** p.levels;
    const n = s.n1;
    const at = (i: number, j: number) => j * n + i;
    const computeCustom = async (pts: number[]) => {
      const cu = p.custom!, st = cu.stride, todo: number[] = [], got: { y: number[]; C: number }[] = [];
      for (const k of pts) {
        const i = k % n, j = (k - i) / n, r = cu.state(s.psi1[i], s.psi2[j]);
        if (!r) { s.res.set(k, { kind: 'forbidden' }); s.src[k] = k; continue; }
        todo.push(k); got.push(r);
      }
      const P = getPool();
      const modelId = P.setModel(p.modelKey, p.model);
      const chunk = Math.max(4, Math.min(32, Math.ceil(todo.length / (P.size * 4))));
      const jobs: Promise<void>[] = [];
      let last = performance.now();
      for (let c = 0; c < todo.length; c += chunk) {
        const ks = todo.slice(c, c + chunk), gs = got.slice(c, c + chunk);
        const states = new Float64Array(st * ks.length), Cs = new Float64Array(ks.length);
        gs.forEach((g, q) => { states.set(g.y, st * q); Cs[q] = g.C; });
        jobs.push(P.run({ modelId, C: p.C, tEnd: p.tEnd, user: [], userB: [], states, t0: cu.t0, stride: st, maxSym: cu.maxSym, Cs }).then((r) => {
          if (cancelled) return;
          if (r.error) throw new Error(r.error);
          ks.forEach((k, q) => {
            const post = r.tokens[q], tok: number[] = [...cu.prefix];
            for (const id of post) if (tok[tok.length - 1] !== id) tok.push(id);
            s.res.set(k, { kind: 'traj', tokens: Int8Array.from(tok), times: r.times[q], status: r.status[q], tEnd: r.tEnd[q], btokens: new Int8Array(), bstatus: 0 });
            s.src[k] = k;
          });
          s.computed = s.res.size;
          const now = performance.now();
          if (now - last > 250) { last = now; onUpdate(s, `level ${s.level + 1}/${p.levels}: computing`); }
        }));
      }
      await Promise.all(jobs);
    };
    const compute = async (pts: number[]) => {
      if (p.custom) return computeCustom(pts);
      const todo: number[] = [];
      for (const k of pts) {
        const i = k % n, j = (k - i) / n;
        const st = stateAt(p, s.psi1[i], s.psi2[j]);
        if (!st) { s.res.set(k, { kind: 'forbidden' }); s.src[k] = k; continue; }
        if (!inwardAt(p, s.psi1[i], s.psi2[j])) { s.res.set(k, { kind: 'outgoing' }); s.src[k] = k; continue; }
        todo.push(k);
      }
      const P = getPool();
      const modelId = P.setModel(p.modelKey, p.model);
      const chunk = Math.max(8, Math.min(64, Math.ceil(todo.length / (P.size * 4))));
      const jobs: Promise<void>[] = [];
      let last = performance.now();
      for (let c = 0; c < todo.length; c += chunk) {
        const ks = todo.slice(c, c + chunk);
        const states = new Float64Array(6 * ks.length);
        ks.forEach((k, q) => {
          const i = k % n, j = (k - i) / n;
          states.set(stateAt(p, s.psi1[i], s.psi2[j])!, 6 * q);
        });
        jobs.push(P.run({ modelId, C: p.C, tEnd: p.tEnd, user: p.user, userB: p.userB, states }).then((r) => {
          if (cancelled) return;
          if (r.error) throw new Error(r.error);
          ks.forEach((k, q) => {
            s.res.set(k, { kind: 'traj', tokens: r.tokens[q], times: r.times[q], status: r.status[q], tEnd: r.tEnd[q], btokens: r.btokens[q], bstatus: r.bstatus[q] });
            s.src[k] = k;
          });
          s.computed = s.res.size;
          const now = performance.now();
          if (now - last > 250) { last = now; onUpdate(s, `level ${s.level + 1}/${p.levels}: computing`); }
        }));
      }
      await Promise.all(jobs);
    };

    if (s.level < 0) {
      const pts: number[] = [];
      for (let j = 0; j < n; j += S) for (let i = 0; i < n; i += S) pts.push(at(i, j));
      await compute(pts);
      if (cancelled) return s;
      s.level = 0;
      onUpdate(s, 'coarse grid done');
      if (!p.noCache) await cachePut(key, pack(s));
    }
    for (let lev = s.level + 1; lev <= p.levels; lev++) {
      const sp = S / 2 ** (lev - 1), h = sp / 2, nb = (n - 1) / sp;
      const keyAt = (i: number, j: number) => refineKey(s.res.get(s.src[at(i, j)])!, p.user, p.userB, !!p.custom);
      const flag = new Uint8Array(nb * nb);
      for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
        const i0 = bi * sp, j0 = bj * sp;
        const k0 = keyAt(i0, j0);
        if (keyAt(i0 + sp, j0) !== k0 || keyAt(i0, j0 + sp) !== k0 || keyAt(i0 + sp, j0 + sp) !== k0) flag[bj * nb + bi] = 1;
      }
      const refine = new Uint8Array(nb * nb); // dilate by one block
      for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
        if (!flag[bj * nb + bi]) continue;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = bi + di, b = bj + dj;
          if (a >= 0 && b >= 0 && a < nb && b < nb) refine[b * nb + a] = 1;
        }
      }
      const pts = new Set<number>();
      const newPts = (i0: number, j0: number) => [at(i0 + h, j0), at(i0, j0 + h), at(i0 + sp, j0 + h), at(i0 + h, j0 + sp), at(i0 + h, j0 + h)];
      for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
        if (!refine[bj * nb + bi]) continue;
        for (const k of newPts(bi * sp, bj * sp)) if (s.src[k] < 0 || s.src[k] !== k) { if (!s.res.has(k)) pts.add(k); }
      }
      for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
        if (refine[bj * nb + bi]) continue;
        const rep = s.src[at(bi * sp, bj * sp)];
        for (const k of newPts(bi * sp, bj * sp)) if (!pts.has(k) && !s.res.has(k)) s.src[k] = rep;
      }
      onUpdate(s, `level ${lev}/${p.levels}: ${pts.size} new points`);
      await compute([...pts]);
      if (cancelled) return s;
      s.level = lev;
      onUpdate(s, lev === p.levels ? 'done' : `level ${lev}/${p.levels} done`);
      if (!p.noCache) await cachePut(key, pack(s));
    }
    s.done = true;
    onUpdate(s, `done: ${s.computed} trajectories for ${n * n} grid points`);
    return s;
  })();
  return { cancel: () => { cancelled = true; getPool().cancelQueued(); }, promise };
}

/** grid point -> displayed point index for the current level (nearest lattice point) */
export function displayIndex(s: MapState, i: number, j: number): number {
  const n = s.n1;
  if (s.level >= s.p.levels) return s.src[j * n + i];
  const sp = 2 ** (s.p.levels - Math.max(0, s.level));
  const ii = Math.min(n - 1, Math.round(i / sp) * sp), jj = Math.min(n - 1, Math.round(j / sp) * sp);
  const k = s.src[jj * n + ii];
  return k >= 0 ? k : -1;
}
