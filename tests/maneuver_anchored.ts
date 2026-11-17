// Anchored plan: the section is fixed at t = 0, burns after it act forward, burns before it act backward.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { sectionState } = await import('../src/core/section');
const { runPlan, runPlanAnchored, prepareDvMap, applyDv } = await import('../src/core/maneuver');
const { propagate } = await import('../src/core/cr3bp');
const { TSTAR_DAYS } = await import('../src/core/constants');
const jd = 2461135.5, C = 3.1666, H = 30;
const s0 = sectionState(192, 35.7, C)!;
const rel = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a).map((v, i) => Math.abs(v - b[i]) / Math.max(1, Math.abs(v))));
for (const k of ['cr3bp', 'qhr4bp_ecc', 'hfem'] as const) {
  const dyn = makeDyn(await buildModel(k, jd, H + 5));
  const burns: any = [{ id: 1, tDays: -4, frame: 'rot', mag: 9, alpha: 40, beta: 10, on: true }, { id: 2, tDays: 6, frame: 'rot', mag: 5, alpha: 200, beta: 0, on: true }];
  const A = runPlanAnchored(dyn, s0, C, H, burns);
  const F = runPlan(dyn, s0, C, H, burns);
  const x0 = A.P[A.now];
  const b1 = A.burns.find((b: any) => b.burn?.id === 1) ?? A.burns[0];
  const tm1 = (-4 / TSTAR_DAYS) * dyn.tPerTau;
  const re = applyDv(dyn, tm1, b1.yBefore!, 'rot', [9 * Math.cos(10 * Math.PI / 180) * Math.cos(40 * Math.PI / 180), 9 * Math.cos(10 * Math.PI / 180) * Math.sin(40 * Math.PI / 180), 9 * Math.sin(10 * Math.PI / 180)]).y;
  // forward from the post-burn state of burn 1 must land on the section state at t = 0
  const fw = propagate([], { y0: b1.yAfter!, t0: -4 / TSTAR_DAYS, tEnd: 4 / TSTAR_DAYS, dir: 1, C, record: false, hMax: 0.01, dyn } as any);
  const pr = prepareDvMap(dyn, s0, C, H, burns.filter((b: any) => b.tDays < 0), 1, -4, 'rot', true)!;
  const st = pr.state(9, 40, 10);
  const futSame = F.tokens.join() === A.tokens.slice(A.tokens.length - F.tokens.length).join();
  console.log(`${k.padEnd(11)} t=0 point ${Math.hypot(x0[0] - s0[0], x0[1] - s0[1]).toExponential(1)} | t ${(A.t[0] * TSTAR_DAYS).toFixed(1)}..${(A.t.at(-1)! * TSTAR_DAYS).toFixed(1)} d | burn1 re-apply ${rel(re, b1.yAfter!).toExponential(1)} | forward to section ${rel(fw.yEnd, dyn.init(s0)).toExponential(1)} | dv-map past state ${rel(st.y, b1.yBefore!).toExponential(1)} | future word same ${futSame}`);
}
