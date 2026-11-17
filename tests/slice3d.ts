import { edgePieces, sectionStateOn } from '../src/core/boundary';
import { propagate, jacobi } from '../src/core/cr3bp';
import { classWord } from '../src/core/words';
const C = 3.1666, pc = edgePieces(7, 8, C)[0];
let same = 0, n = 0, dCmax = 0;
for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
  const a = 181 + 2 * i, b = 17 + 3 * j;
  const up = sectionStateOn(pc, a, b, C, { z: 0.03, psi3: 10, kappa: 1, vscale: 1 });
  const dn = sectionStateOn(pc, a, b, C, { z: -0.03, psi3: -10, kappa: 1, vscale: 1 });
  if (!up || !dn) continue;
  dCmax = Math.max(dCmax, Math.abs(jacobi(up) - C));
  const ru = propagate(up, { tEnd: 15, C, record: true }), rd = propagate(dn, { tEnd: 15, C });
  n++; if (classWord(ru.tokens, ru.status, true) === classWord(rd.tokens, rd.status, true)) same++;
}
console.log(`3D slice: Jacobi of section states = C to ${dCmax.toExponential(1)}; z -> -z mirror gives the same word in ${same}/${n}`);
