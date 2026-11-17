// Checks of the impulsive-maneuver code in every model.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn, LSTAR, TSTAR_S } = await import('../src/core/models');
const { propagate, jacobi } = await import('../src/core/cr3bp');
const { sectionState } = await import('../src/core/section');
const { runPlan, applyDv, inertialState, frameAxes, prepareDvMap } = await import('../src/core/maneuver');

const jd = 2461135.5, C = 3.1666, H = 40;
const s0 = sectionState(192, 35.7, C)!;
const kinds = ['cr3bp', 'er3bp', 'hr4bp', 'qhr4bp_ecc', 'qhr4bp_inc', 'hfem'] as const;
for (const k of kinds) {
  const dyn = makeDyn(await buildModel(k, jd, H + 5));
  // 1) no burns == plain propagation
  const plain = propagate(s0, { tEnd: H / 4.3482, C, record: true, hMax: 0.01, dyn });
  const p0 = runPlan(dyn, s0, C, H, []);
  const same = p0.tokens.join() === plain.tokens.join();
  // 2) a zero burn at 5 d changes nothing (restart of the integrator only)
  const pz = runPlan(dyn, s0, C, H, [{ id: 1, tDays: 5, frame: 'vnb-moon', mag: 0, alpha: 0, beta: 0, on: true }]);
  const dEnd = Math.hypot(...pz.segs.at(-1)!.res.yEnd!.slice(0, 3).map((v, i) => v - plain.yEnd![i])) / Math.hypot(...plain.yEnd!.slice(0, 3));
  // 3) measured inertial dv equals the request, in each frame
  const r5 = propagate(s0, { tEnd: 5 / 4.3482, C, dyn });
  const tm = r5.tEnd * dyn.tPerTau, y = r5.yEnd!;
  const errs: string[] = [];
  for (const fr of ['vnb-moon', 'vnb-earth', 'rot'] as const) {
    const dv: [number, number, number] = [12, -7, 4];
    const before = inertialState(dyn, tm, y), { y: ya } = applyDv(dyn, tm, y, fr, dv), after = inertialState(dyn, tm, ya);
    const ax = frameAxes(dyn, tm, y, fr);
    const got = [0, 1, 2].map((j) => 1000 * [0, 1, 2].reduce((a, i) => a + ax[j][i] * (after.v[i] - before.v[i]), 0));
    errs.push(`${fr} ${got.map((v) => v.toFixed(4)).join('/')}`);
  }
  // 4) C after a burn (CR3BP: exact Jacobi)
  const pb = runPlan(dyn, s0, C, H, [{ id: 1, tDays: 5, frame: 'vnb-moon', mag: 20, alpha: 0, beta: 0, on: true }]);
  const b = pb.burns[0];
  const cChk = k === 'cr3bp' ? ` | C after ${b.CAfter!.toFixed(8)} vs jacobi ${jacobi(b.yAfter!).toFixed(8)}` : ` | C ${b.CBefore!.toFixed(5)} -> ${b.CAfter!.toFixed(5)}`;
  // 5) dv-map fast state == full plan (two burns; the map is for the second one)
  const two: any = [{ id: 1, tDays: 3, frame: 'vnb-moon', mag: 6, alpha: 30, beta: 5, on: true }, { id: 2, tDays: 9, frame: 'rot', mag: 11, alpha: -120, beta: -20, on: true }];
  const full = runPlan(dyn, s0, C, H, two), pr = prepareDvMap(dyn, s0, C, H, two, 2, 9, 'rot', false)!;
  const st = pr.state(11, -120, -20), b2 = full.burns[1];
  const dy = Math.max(...st.y.map((v, i) => Math.abs(v - b2.yAfter![i]) / Math.max(1, Math.abs(b2.yAfter![i]))));
  const post = propagate([], { y0: st.y, t0: pr.tau, tEnd: H / 4.3482 - pr.tau, C: st.C, dyn });
  const tok = [...pr.prefix]; for (const id of post.tokens) if (tok[tok.length - 1] !== id) tok.push(id);
  const mapOk = tok.join() === full.tokens.join() && Math.abs(st.C - b2.CAfter!) < 1e-9;
  console.log(`${k.padEnd(11)} dv-map state vs plan: max rel diff ${dy.toExponential(1)}, word+C equal ${mapOk}`);
  console.log(`${k.padEnd(11)} same=${same} zero-burn drift ${dEnd.toExponential(1)} | dv [12,-7,4] m/s -> ${errs.join(' ; ')}${cChk} | prograde 20 m/s word ${pb.tokens.length} tok vs ${p0.tokens.length}`);
}
// CR3BP analytic: rotating-x burn of 10 m/s changes vx by 10e-3 / (LSTAR / TSTAR_S)
const dyn = makeDyn({ kind: 'cr3bp' });
const y = Float64Array.from(s0);
const { y: ya } = applyDv(dyn, 0, y, 'rot', [10, 0, 0]);
console.log('CR3BP rot-x 10 m/s: d vx =', (ya[3] - y[3]).toExponential(6), 'expected', (0.01 / (LSTAR / TSTAR_S)).toExponential(6), 'd vy', (ya[4] - y[4]).toExponential(1));
