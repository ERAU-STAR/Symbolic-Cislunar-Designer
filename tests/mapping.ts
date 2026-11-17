// How similar are the model maps to CR3BP under two IC mappings?
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => { const b = readFileSync(new URL(u).pathname); return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()) }; };
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn, LSTAR, ECC, SMA } = await import('../src/core/models');
const { propagate } = await import('../src/core/cr3bp');
const { classWord } = await import('../src/core/words');
const { twoU, X_MOON, A_STAR, B_STAR } = await import('../src/core/constants');
const jd = +(process.argv[2] ?? 2461135.5), C = 3.1666;
const pts: [number, number][] = [];
for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) pts.push([181 + (23 * i) / 25, 17 + (35 * j) / 25]);
const state = (a: number, b: number, kap: number) => {
  const p = a * Math.PI / 180, q = b * Math.PI / 180, x = X_MOON + (A_STAR + 1e-9) * Math.cos(p), y = (B_STAR + 1e-9) * Math.sin(p);
  const v2 = kap * twoU(x, y) - C; if (!(v2 > 0)) return null; const v = Math.sqrt(v2);
  return [x, y, 0, v * Math.cos(q), v * Math.sin(q), 0];
};
const words = (dyn: any, kap: number, vs = 1) => pts.map(([a, b]) => { const s0 = state(a, b, kap); if (!s0) return 'forbidden'; const s = [s0[0], s0[1], 0, s0[3] * vs, s0[4] * vs, 0]; const r = propagate(s, { tEnd: 15, C, dyn }); return classWord(r.tokens, r.status, true); });
const ref = words(makeDyn({ kind: 'cr3bp' }), 1);
for (const k of ['er3bp', 'hr4bp', 'qhr4bp_ecc', 'hfem'] as const) {
  const dyn = makeDyn(await buildModel(k, jd, 70));
  const l0 = dyn.ell(0, dyn.init([X_MOON + A_STAR, 0, 0, 0, 0.1, 0]));
  const kap = (SMA * (1 - ECC * ECC)) / l0; // p / l(t0)
  const same = (w: string[]) => (100 * w.filter((x, i) => x === ref[i]).length / w.length).toFixed(1);
  const wI = words(dyn, 1), wE = words(dyn, kap), wN = words(dyn, 1, 1 / dyn.k);
  console.log(`${k.padEnd(11)} l0 = ${l0.toFixed(0)} km, kappa = ${kap.toFixed(4)} | same class as CR3BP: instantaneous ${same(wI)} %, energy-matched ${same(wE)} %, same pulsating numbers (no rate scaling, k = ${dyn.k.toFixed(3)}) ${same(wN)} %`);
}
