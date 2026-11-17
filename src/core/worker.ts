/// <reference lib="webworker" />
// Map worker: propagates batches of section states in the selected model.
import { propagate, classEnd } from './cr3bp';
import { wordNames } from './words';
import { makeDyn, type Dyn, type ModelParams } from './models';

export interface InitMsg { type: 'init'; modelId: number; model: ModelParams }
export interface JobMsg {
  type: 'job';
  id: number;
  modelId: number;
  C: number;
  tEnd: number; // tau
  user: number[]; // forward part of the user word, from the section's source region (fine ids)
  userB: number[]; // backward part, reversed, also starting with the source region ([] = none)
  states: Float64Array; // 6*n section states (instantaneous units), or stride*n model states when t0 is set
  /** custom maps (dv map): states are model states at model time t0*tPerTau, each with its own C */
  t0?: number;
  stride?: number;
  maxSym?: number;
  Cs?: Float64Array;
}
export interface JobResult {
  id: number;
  tokens: Int8Array[]; // fine ids
  times: Float32Array[];
  status: Uint8Array;
  tEnd: Float32Array;
  btokens: Int8Array[]; // backward tokens (empty when no backward word)
  bstatus: Uint8Array;
  error?: string;
}

const models = new Map<number, Dyn>();

self.onmessage = (ev: MessageEvent<InitMsg | JobMsg>) => {
  const m = ev.data;
  if (m.type === 'init') { models.clear(); models.set(m.modelId, makeDyn(m.model)); return; }
  const { id, C, tEnd, user, userB, states } = m;
  const n = states.length / (m.t0 !== undefined ? m.stride! : 6);
  const out: JobResult = { id, tokens: [], times: [], status: new Uint8Array(n), tEnd: new Float32Array(n), btokens: [], bstatus: new Uint8Array(n) };
  const dyn = models.get(m.modelId);
  if (!dyn) { out.error = 'model not initialised'; (self as unknown as Worker).postMessage(out); return; }
  const userFine = wordNames(user, false);
  const userCoarse = wordNames(user, true);
  // stop once the paper class word is complete AND the user word is either
  // fully matched (plus one more symbol) or no longer matched; divergence is
  // tested in the coarse alphabet (implies fine divergence) so both stay exact
  const stop = (tok: number[]) => {
    if (classEnd(tok) < 0) return false;
    const c = wordNames(tok, true);
    let k = 0;
    while (k < c.length && k < userCoarse.length && c[k] === userCoarse[k]) k++;
    const diverged = k < Math.min(c.length, userCoarse.length);
    return diverged || wordNames(tok, false).length > userFine.length;
  };
  if (m.t0 !== undefined) {
    const st = m.stride!, maxSym = m.maxSym ?? 10;
    for (let k = 0; k < n; k++) {
      const r = propagate([], { y0: states.subarray(st * k, st * k + st), t0: m.t0, tEnd: Math.abs(tEnd - m.t0), dir: tEnd >= m.t0 ? 1 : -1, C: m.Cs![k], dyn, stop: (tok) => tok.length > maxSym });
      out.tokens.push(Int8Array.from(r.tokens)); out.times.push(Float32Array.from(r.times));
      out.status[k] = r.status; out.tEnd[k] = r.tEnd; out.btokens.push(new Int8Array());
    }
    (self as unknown as Worker).postMessage(out);
    return;
  }
  for (let k = 0; k < n; k++) {
    const s = Array.from(states.subarray(6 * k, 6 * k + 6));
    const r = propagate(s, { tEnd, C, stop, dyn });
    out.tokens.push(Int8Array.from(r.tokens));
    out.times.push(Float32Array.from(r.times));
    out.status[k] = r.status;
    out.tEnd[k] = r.tEnd;
    if (userB.length > 1 && r.tokens.length) {
      // backward: stop once the past word is decided (diverged, or matched plus one symbol)
      const bc = wordNames(userB, true), bf = wordNames(userB, false);
      const stopB = (tok: number[]) => {
        const c = wordNames(tok, true);
        let q = 0;
        while (q < c.length && q < bc.length && c[q] === bc[q]) q++;
        return q < Math.min(c.length, bc.length) || wordNames(tok, false).length > bf.length;
      };
      const b = propagate(s, { tEnd, C, stop: stopB, dyn, dir: -1 });
      out.btokens.push(Int8Array.from(b.tokens));
      out.bstatus[k] = b.status;
    } else out.btokens.push(new Int8Array());
  }
  (self as unknown as Worker).postMessage(out);
};
