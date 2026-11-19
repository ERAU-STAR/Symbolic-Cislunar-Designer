// Sequential design (per-burn future / past) against the earlier anchored and backward plans.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { sectionState } = await import('../src/core/section');
const { runPlanSeq, runPlanAnchored, runPlanBackward, prepareDvMapSeq } = await import('../src/core/maneuver');
const jd = 2461135.5, C = 3.1666, H = 30;
const s0 = sectionState(192, 35.7, C)!;
const rel = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a).map((v, i) => Math.abs(v - b[i]) / Math.max(1, Math.abs(v))));
let bad = 0;
for (const k of ['cr3bp', 'qhr4bp_ecc', 'hfem'] as const) {
  const dyn = makeDyn(await buildModel(k, jd, H + 5));
  const B: any[] = [
    { id: 1, tDays: -4, frame: 'rot', mag: 9, alpha: 40, beta: 10, on: true },
    { id: 2, tDays: 6, frame: 'vnb-moon', mag: 5, alpha: 200, beta: 0, on: true },
    { id: 3, tDays: 2, frame: 'rot', mag: 3, alpha: -30, beta: 5, on: true },
  ];
  // 1. default sides, applied outwards from the section = anchored plan
  const byAbs = [...B].sort((a, b) => Math.abs(a.tDays) - Math.abs(b.tDays));
  const S = runPlanSeq(dyn, s0, C, H, byAbs), A = runPlanAnchored(dyn, s0, C, H, B);
  let e1 = 0; for (const r of S.burns) { const a = A.burns.find((x) => x.burn.id === r.burn.id)!; e1 = Math.max(e1, rel(r.yBefore!, a.yBefore!), rel(r.yAfter!, a.yAfter!)); }
  const w1 = S.tokens.join() === A.tokens.join();
  // 2. all past, latest first = backward plan (keep the end); the two reach the burn times along different
  //    integration paths, so they agree to the integrator tolerance
  const past = [...B].sort((a, b) => b.tDays - a.tDays).map((b) => ({ ...b, side: 'past' }));
  const S2 = runPlanSeq(dyn, s0, C, H, past), K = runPlanBackward(dyn, s0, C, H, B);
  let e2 = 0; for (const r of S2.burns) { const a = K.burns.find((x) => x.burn.id === r.burn.id)!; e2 = Math.max(e2, rel(r.yBefore!, a.yBefore!), rel(r.yAfter!, a.yAfter!)); }
  // 3. mixed: a past burn after the section, then a future burn before it; dv map reproduces the plan state
  const mix: any[] = [{ ...B[1], side: 'past' }, { ...B[0], side: 'future' }];
  const S3 = runPlanSeq(dyn, s0, C, H, mix);
  const pr = prepareDvMapSeq(dyn, s0, C, H, [mix[0]], mix[1].tDays, mix[1].frame, 'future')!;
  const st = pr.state(mix[1].mag, mix[1].alpha, mix[1].beta);
  const e3 = rel(st.y, S3.burns[1].yAfter!), c3 = Math.abs(st.C - S3.burns[1].CAfter!);
  const pr2 = prepareDvMapSeq(dyn, s0, C, H, [], mix[0].tDays, mix[0].frame, 'past')!;
  const e4 = rel(pr2.state(mix[0].mag, mix[0].alpha, mix[0].beta).y, S3.burns[0].yBefore!);
  // time order and continuity of the samples
  const mono = S3.t.every((t, i) => i === 0 || t >= S3.t[i - 1]);
  const ok = e1 < 1e-9 && w1 && e2 < 1e-7 && e3 < 1e-9 && c3 < 1e-9 && e4 < 1e-9 && mono && S3.burns.every((b) => b.reached);
  if (!ok) bad++;
  console.log(`${k.padEnd(11)} = anchored ${e1.toExponential(1)} word ${w1} | = backward ${e2.toExponential(1)} | mixed: dv map ${e3.toExponential(1)} C ${c3.toExponential(1)}, past map ${e4.toExponential(1)}, t ${(S3.t[0] * 4.348).toFixed(1)}..${(S3.t.at(-1)! * 4.348).toFixed(1)} d, ascending ${mono} | ${ok ? 'OK' : 'FAIL'}`);
}
process.exit(bad ? 1 : 0);
