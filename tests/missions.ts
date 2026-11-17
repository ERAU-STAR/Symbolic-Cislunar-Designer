// Mission import: parse, convert, crossings, maneuvers; HFEM reproduces the mission from a crossing.
import { readFileSync } from 'node:fs';
(globalThis as any).document = { baseURI: 'file:///home/claude/symapp/public/' };
(globalThis as any).fetch = async (u: string) => {
  const p = new URL(u).pathname; const b = readFileSync(p);
  return { ok: true, text: async () => b.toString(), json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { parseMission, processMission, tdbToIso, BUILTIN } = await import('../src/core/mission');
const { buildModel } = await import('../src/core/modelSetup');
const { makeDyn, TSTAR_S } = await import('../src/core/models');
const { propagate } = await import('../src/core/cr3bp');
const { NAMES } = await import('../src/core/symbols');
const { TSTAR_DAYS } = await import('../src/core/constants');
const only = process.argv[2];
for (const b of BUILTIN) {
  if (only && b.id !== only) continue;
  const t0 = Date.now();
  const raw = parseMission(readFileSync('/home/claude/symapp/public/data/missions/' + b.file, 'utf8'), b.name);
  const M = await processMission(raw, {});
  console.log(`\n== ${b.name}: ${raw.jd.length} states ${tdbToIso(raw.jd[0])} .. ${tdbToIso(raw.jd.at(-1)!)} (${raw.source}, ${raw.frame}) ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`   word (${M.tokens.length} symbols): ${M.tokens.slice(0, 24).map((i) => NAMES[i]).join(' ')}${M.tokens.length > 24 ? ' …' : ''}`);
  const usable = M.crossings.filter((c) => c.piece);
  console.log(`   crossings ${M.crossings.length}, usable as sections ${usable.length}; C range ${Math.min(...M.C).toFixed(3)} .. ${Math.max(...M.C).toFixed(3)}`);
  console.log(`   burns (> 0.5 m/s) ${M.burns.length}: ` + M.burns.slice(0, 12).map((x) => `${tdbToIso(x.jd, false)} ${x.mag.toFixed(2)} m/s a${x.alpha.toFixed(0)} b${x.beta.toFixed(0)}`).join(' | '));
  // reproduce: first lunar-ellipse entry, HFEM from that crossing for up to 3 d (or to the next burn)
  const c = M.crossings.find((x) => x.piece && x.piece.shape.id === 'ellipse' && NAMES[x.tgt].startsWith('M_'));
  if (c) {
    const dyn = makeDyn(await buildModel('hfem', c.jd, 10));
    const nb = M.burns.find((x) => x.jd0 > c.jd);
    const span = Math.min(3, nb ? nb.jd0 - c.jd - 0.01 : 3);
    const y0 = dyn.init(c.x);
    const k1 = M.jd.findIndex((j) => j > c.jd);
    // compare the init with the interpolated mission state near the crossing (one sample later, propagated)
    const kEnd = M.jd.findIndex((j) => j > c.jd + span) - 1;
    const r = propagate([], { y0, t0: 0, tEnd: ((M.jd[kEnd] - c.jd) * 86400) / TSTAR_S, C: c.C, dyn });
    const d = Math.hypot(r.yEnd![0] - M.X[kEnd][0], r.yEnd![1] - M.X[kEnd][1], r.yEnd![2] - M.X[kEnd][2]);
    console.log(`   from ${NAMES[c.src]}->${NAMES[c.tgt]} at ${tdbToIso(c.jd)} (s ${c.s.toFixed(2)}, psi2 ${c.psi2.toFixed(2)}, z ${c.z.toFixed(4)}, psi3 ${c.psi3.toFixed(2)}, C ${c.C.toFixed(4)}): HFEM after ${(M.jd[kEnd] - c.jd).toFixed(2)} d differs by ${d.toFixed(1)} km (k1 ${k1})`);
  }
}
void TSTAR_DAYS;
