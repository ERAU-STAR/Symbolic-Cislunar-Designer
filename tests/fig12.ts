// Validation against the paper's Fig. 12 (C = 3.1666, E_R -> M_L section)
import { readFileSync } from 'node:fs';
import { propagate } from '../src/core/cr3bp';
import { sectionState, inward } from '../src/core/section';
import { classWord } from '../src/core/words';
import { C_L1, C_L2, X_L1, X_L2 } from '../src/core/constants';

const labels: string[] = JSON.parse(readFileSync('validation/fig12_labels.json', 'utf8'));
const lab = new Map<string, number>();
for (const s of labels) {
  const m = s.match(/\$(\d+):(.*)\$/)!;
  const w = m[2].split(String.fromCharCode(92)).join('').replace(/;/g, ' ').replace(/_\{(\w+)\}/g, '_$1').replace(/\^\{\*\}/g, '*').trim().split(/\s+/).join(' ');
  lab.set(w, +m[1]);
}
const grid = JSON.parse(readFileSync('validation/fig12_grid.json', 'utf8')) as { psi1: number[]; psi2: number[]; cls: number[][] };
const C = 3.1666, horizon = +(process.argv[2] ?? 15), stride = +(process.argv[3] ?? 7);
console.log('C_L1', C_L1.toFixed(6), 'C_L2', C_L2.toFixed(6), 'xL1', X_L1.toFixed(9), 'xL2', X_L2.toFixed(9));
let n = 0, agree = 0, t0 = Date.now(); const conf = new Map<string, number>();
for (let i = 0; i < grid.psi1.length; i += stride) for (let j = 0; j < grid.psi2.length; j += stride) {
  const want = grid.cls[j][i];
  const s = sectionState(grid.psi1[i], grid.psi2[j], C);
  if (!s || !inward(grid.psi1[i], grid.psi2[j])) { if (want !== 0) conf.set('noIC->' + want, (conf.get('noIC->' + want) ?? 0) + 1); continue; }
  const r = propagate(s, { tEnd: horizon, C });
  const w = classWord(r.tokens, r.status, true);
  const got = lab.get(w) ?? 0;
  n++; if (got === want) agree++; else { const k = `${got}<-${want}`; conf.set(k, (conf.get(k) ?? 0) + 1); }
}
console.log(`horizon ${horizon}: agree ${agree}/${n} = ${(100 * agree / n).toFixed(1)}%  (${((Date.now() - t0) / n).toFixed(1)} ms/traj)`);
console.log([...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
