// How a section point (rho, psi2, C, slice) becomes each model's initial state.
import { ECC, SMA, type Dyn, type ModelKind } from './models';
import type { SectionOpts } from './boundary';

export type Mapping = 'rate' | 'energy' | 'numbers';
export interface Slice { mapping: Mapping; z: number; psi3: number }

export const MAPPING_LABEL: Record<Mapping, string> = {
  rate: 'Same position, angular-rate-normalised velocity (default)',
  energy: "Model's own Jacobi-like value at the epoch: speed² = (p/l₀)·2U − C",
  numbers: 'Same pulsating numbers as CR3BP (no rate scaling)',
};

export function sectionOpts(kind: ModelKind, dyn: Dyn | null, s: Slice): SectionOpts {
  if (!dyn || kind === 'cr3bp') return { z: s.z, psi3: s.psi3, kappa: 1, vscale: 1 };
  const p = SMA * (1 - ECC * ECC); // semi-latus rectum of the ER3BP Moon orbit [km]
  return {
    z: s.z, psi3: s.psi3,
    kappa: s.mapping === 'energy' ? p / dyn.l0 : 1,
    vscale: s.mapping === 'numbers' ? 1 / dyn.k : 1,
  };
}
