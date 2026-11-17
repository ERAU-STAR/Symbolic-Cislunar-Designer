// Backward-mode maneuvers and the generalised dv-map preparation.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { sectionState } = await import('../src/core/section');
const { runPlan, runPlanBackward, prepareDvMap, applyDv } = await import('../src/core/maneuver');
const { TSTAR_DAYS } = await import('../src/core/constants');
const jd = 2461135.5, C = 3.1666, H = 30;
const s0 = sectionState(192, 35.7, C)!;
for (const k of ['cr3bp', 'qhr4bp_ecc', 'hfem'] as const) {
  const dyn = makeDyn(await buildModel(k, jd, H + 5));
  const plain = runPlanBackward(dyn, s0, C, H, []);
  const x0 = plain.P[plain.now];
  const fw = runPlan(dyn, s0, C, H, []);
  const futOk = plain.tokens.slice(plain.tokens.indexOf(fw.tokens[1]) - 1).length > 0;
  // backward burns in the rotating frame (axes do not depend on the velocity): forward check
  const burns: any = [{ id: 1, tDays: -4, frame: 'rot', mag: 9, alpha: 40, beta: 10, on: true }, { id: 2, tDays: 6, frame: 'rot', mag: 5, alpha: 200, beta: 0, on: true }];
  const B = runPlanBackward(dyn, s0, C, H, burns);
  const b2 = B.burns[1], b1 = B.burns[0];
  const tm2 = (6 / TSTAR_DAYS) * dyn.tPerTau;
  const re = applyDv(dyn, tm2, b2.yBefore!, 'rot', [5 * Math.cos(200 * Math.PI / 180), 5 * Math.sin(200 * Math.PI / 180), 0]).y;
  const err = Math.max(...Array.from(re).map((v, i) => Math.abs(v - b2.yAfter![i]) / Math.max(1, Math.abs(v))));
  // dv map (backward) at burn 1 reproduces its pre-burn state
  const pr = prepareDvMap(dyn, s0, C, H, burns, 1, -4, 'rot', true)!;
  const st = pr.state(9, 40, 10);
  const err2 = Math.max(...st.y.map((v, i) => Math.abs(v - b1.yBefore![i]) / Math.max(1, Math.abs(v))));
  const cerr = Math.abs(st.C - b1.CBefore!);
  console.log(`${k.padEnd(11)} section point at t=0: ${Math.hypot(x0[0] - s0[0], x0[1] - s0[1]).toExponential(1)} | samples ${B.t.length} t ${(B.t[0] * TSTAR_DAYS).toFixed(1)}..${(B.t.at(-1)! * TSTAR_DAYS).toFixed(1)} d | burn2 forward re-application ${err.toExponential(1)} | dv-map backward state ${err2.toExponential(1)} C ${cerr.toExponential(1)} | reached ${B.burns.map((b) => b.reached)} | ${futOk}`);
}
