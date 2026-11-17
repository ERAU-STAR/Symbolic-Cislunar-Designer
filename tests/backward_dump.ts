import { readFileSync, writeFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => { const b = readFileSync(new URL(u).pathname); return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()) }; };
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { propagate } = await import('../src/core/cr3bp');
const { sectionState } = await import('../src/core/section');
const jd = 2461135.5, C = 3.1666, s = sectionState(190.2, 34.5, C)!;
const out: any = { jd, models: {} };
for (const k of ['cr3bp', 'er3bp', 'qhr4bp_ecc', 'hfem'] as const) {
  const dyn = makeDyn(await buildModel(k, jd, 30));
  const r = propagate(s, { tEnd: 2.0, C, dyn, dir: -1, record: true });
  const f = propagate(s, { tEnd: 2.0, C, dyn, record: true });
  out.models[k] = { y0: r.Y0, back: r.P!.at(-1), tBack: r.tEnd, fwd: f.P!.at(-1), status: r.status, btok: r.tokens };
  console.log(k, 'back end', r.P!.at(-1)!.map((v) => v.toFixed(6)), 'tokens', r.tokens.join(','));
}
// CR3BP time-reversal symmetry: backward of (x,y,vx,vy) = mirror of forward of (x,-y,-vx,vy)
const dyn = makeDyn({ kind: 'cr3bp' });
const b = propagate(s, { tEnd: 2, C, dyn, dir: -1, record: true });
const m = propagate([s[0], -s[1], 0, -s[3], s[4], 0], { tEnd: 2, C, dyn, record: true });
console.log('symmetry error', Math.hypot(b.P!.at(-1)![0] - m.P!.at(-1)![0], b.P!.at(-1)![1] + m.P!.at(-1)![1]).toExponential(2), b.tEnd, m.tEnd);
writeFileSync('/tmp/claude-0/-home-claude/d5edbce9-120c-5167-b80a-04901b8edc29/scratchpad/js_back.json', JSON.stringify(out));
