// Dump JS model results for cross-checking against the Python engine.
import { readFileSync, writeFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { buildModel, epochInfo } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { propagate } = await import('../src/core/cr3bp');
const { sectionState, inward } = await import('../src/core/section');
const { classWord } = await import('../src/core/words');

const jd = +(process.argv[2] ?? 2461135.5), C = 3.1666, tEnd = 15;
const kinds = ['cr3bp', 'er3bp', 'hr4bp', 'qhr4bp_ecc', 'qhr4bp_inc', 'hfem'] as const;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pts: number[][] = [];
while (pts.length < 60) { const a = 181 + 23 * rnd(), b = 17 + 35 * rnd(); if (sectionState(a, b, C) && inward(a, b)) pts.push([a, b]); }
const out: any = { jd, C, tEnd, epoch: await epochInfo(jd), pts, models: {} };
for (const k of kinds) {
  const t0 = Date.now();
  const P = await buildModel(k, jd, tEnd * 4.348 + 5);
  const dyn = makeDyn(P);
  const rows = pts.map(([a, b]) => { const r = propagate(sectionState(a, b, C)!, { tEnd, C, dyn }); return { y0: r.Y0, word: classWord(r.tokens, r.status, true), status: r.status, tEnd: r.tEnd }; });
  out.models[k] = { k: dyn.k, rows };
  console.log(k, 'k =', dyn.k.toFixed(5), `${((Date.now() - t0) / pts.length).toFixed(1)} ms/traj`, rows.slice(0, 2).map((r) => r.word));
}
writeFileSync('/tmp/claude-0/-home-claude/d5edbce9-120c-5167-b80a-04901b8edc29/scratchpad/js_models.json', JSON.stringify(out));
