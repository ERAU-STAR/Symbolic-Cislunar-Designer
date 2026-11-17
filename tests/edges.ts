import { readFileSync } from 'node:fs';
import { edgePieces, sectionStateOn, intoTarget, pieceWindow } from '../src/core/boundary';
import { graphAt, NAMES } from '../src/core/symbols';
import { regimeIndex } from '../src/core/constants';
import { propagate } from '../src/core/cr3bp';
import { classWord } from '../src/core/words';
for (const C of [3.1666, 3.0]) {
  const g = graphAt(regimeIndex(C)); const miss: string[] = [];
  console.log(`C = ${C}: G${g.regime}, ${g.edges.length} edges`);
  for (const e of g.edges) {
    const ps = edgePieces(e.a, e.b, C);
    if (!ps.length) { miss.push(`${NAMES[e.a]}-${NAMES[e.b]}`); continue; }
    if (C === 3.0) continue;
    console.log(`  ${NAMES[e.a]}->${NAMES[e.b]}: ` + ps.map((p) => `${p.shape.id} [${p.s0.toFixed(3)}, ${p.s1.toFixed(3)}] sign ${p.sign}`).join('; '), JSON.stringify(pieceWindow(ps[0])));
  }
  console.log('  edges without a boundary piece:', miss.join(' ') || 'none');
}
// Fig. 12 through the general section
const labels: string[] = JSON.parse(readFileSync('validation/fig12_labels.json', 'utf8'));
const lab = new Map<string, number>();
for (const s of labels) { const m = s.match(/\$(\d+):(.*)\$/)!; lab.set(m[2].split(String.fromCharCode(92)).join('').replace(/;/g, ' ').replace(/_\{(\w+)\}/g, '_$1').replace(/\^\{\*\}/g, '*').trim().split(/\s+/).join(' '), +m[1]); }
const grid = JSON.parse(readFileSync('validation/fig12_grid.json', 'utf8'));
const pc = edgePieces(7, 8, 3.1666)[0]; let n = 0, ok = 0;
for (let i = 0; i < grid.psi1.length; i += 5) for (let j = 0; j < grid.psi2.length; j += 5) {
  const s = sectionStateOn(pc, grid.psi1[i], grid.psi2[j], 3.1666);
  if (!s || !intoTarget(pc, grid.psi1[i], grid.psi2[j])) continue;
  const r = propagate(s, { tEnd: 15, C: 3.1666 }); n++;
  if ((lab.get(classWord(r.tokens, r.status, true)) ?? 0) === grid.cls[j][i]) ok++;
}
console.log(`Fig. 12 via the general section: ${ok}/${n} = ${(100 * ok / n).toFixed(1)}%`);
