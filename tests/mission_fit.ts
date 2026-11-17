// Fitted mission maneuvers make the app trajectory follow the real one.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => { const p = new URL(u).pathname; const b = readFileSync(p); return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const { parseMission, processMission, missionStateAt, tdbToIso, BUILTIN } = await import('../src/core/mission');
const { fitMissionBurns } = await import('../src/core/missionFit');
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn } = await import('../src/core/models');
const { runPlan, runPlanAnchored } = await import('../src/core/maneuver');
const { sectionStateOn } = await import('../src/core/boundary');
const { sectionOpts } = await import('../src/core/icmap');
const { TSTAR_DAYS } = await import('../src/core/constants');
const { NAMES, isLunar } = await import('../src/core/symbols');
const H = +(process.argv[3] ?? 25);
for (const b of BUILTIN.filter((x) => x.id === (process.argv[2] ?? 'artemis1'))) {
  const M = await processMission(parseMission(readFileSync('/home/claude/symapp/public/data/missions/' + b.file, 'utf8'), b.name), {});
  const c = M.crossings.find((x) => x.piece && !isLunar(x.src) && isLunar(x.tgt))!;
  const dyn = makeDyn(await buildModel('hfem', c.jd, H));
  const s0 = sectionStateOn(c.piece!, c.s, c.psi2, c.C, sectionOpts('hfem', dyn, { mapping: 'rate', z: c.z, psi3: c.psi3 }))!;
  const det = M.burns.filter((x) => Math.abs(x.jd - c.jd) < H).map((x, q) => ({ id: q + 1, tDays: x.jd - c.jd, frame: 'vnb-moon' as const, mag: x.mag, alpha: x.alpha, beta: x.beta, on: true }));
  const err = (bs: any[]) => {
    const P = runPlanAnchored(dyn, s0, C0(c), H, bs);
    // compare geocentric positions: rebuild model states from the plan segments' records is not available; use inertial snapshots
    return P;
  };
  function C0(x: any) { return x.C; }
  const t0 = Date.now();
  const F = await fitMissionBurns(dyn, s0, c.C, c.jd, H, det, M);
  console.log(`${b.name}: crossing ${tdbToIso(c.jd)} ${NAMES[c.src]}->${NAMES[c.tgt]}, fit ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const f of F.info) console.log(`   burn ${f.id}: detected ${f.detected.toFixed(2)} -> fitted ${f.fitted.toFixed(2)} m/s, miss ${f.missKm.toFixed(3)} km at ${f.targetDays >= 0 ? "+" : ""}${f.targetDays.toFixed(2)} d ${f.ok ? '' : '(not converged)'}`);
  // deviation of the planned trajectory from the real one, in km, sampled daily (inertial snapshots -> compare via positions)
  for (const [lab, bs] of [['detected', det], ['fitted', F.burns]] as const) {
    const P = err(bs as any[]);
    const devs: string[] = [];
    for (let d = -H + 1; d < H; d += 2) {
      const q = P.t.findIndex((t) => t * TSTAR_DAYS >= d); if (q < 0) break; if (!missionStateAt(M, c.jd + P.t[q] * TSTAR_DAYS)) { if (d < 0) continue; break; }
      const X = missionStateAt(M, c.jd + P.t[q] * TSTAR_DAYS); if (!X) break;
      const I = P.I![q]; // Earth-centred, epoch EM plane, 384400 km units: compare distances from Earth and Moon instead
      const rE = Math.hypot(...I.sc) * 384400, rM = Math.hypot(I.sc[0] - I.moon[0], I.sc[1] - I.moon[1], I.sc[2] - I.moon[2]) * 384400;
      const XE = Math.hypot(X[0], X[1], X[2]);
      devs.push(`${d}d:${Math.abs(rE - XE).toFixed(0)}`);
      void rM;
    }
    console.log(`   ${lab.padEnd(8)} |r_E| deviation [km]: ${devs.join(' ')}`);
  }
}
