// Re-fit a mission's maneuvers in the app's own model so the designed trajectory follows the real one.
// The detected impulses are only first guesses: the model (point-mass HFEM, DE421) drifts from the
// flown path (tens of km by a 130 km lunar flyby) and a finite burn is not an impulse. Each burn,
// in time order, is solved (Newton, finite-difference Jacobian) so that the model trajectory after it
// passes through the real position at a target time after the burn.
import { propagate } from './cr3bp';
import { applyDv, dvComponents, type Burn } from './maneuver';
import { TSTAR_DAYS } from './constants';
import { missionStateAt, type Mission } from './mission';
import type { Dyn } from './models';

type V3 = [number, number, number];
export interface FitInfo { id: number; detected: number; fitted: number; missKm: number; targetDays: number; ok: boolean; noData?: boolean }

/** VNB (or x y z) components -> (mag, alpha, beta) in the app's convention */
function polar(frame: Burn['frame'], d: V3) {
  const [a, b, c] = frame === 'rot' ? [d[0], d[1], d[2]] : [d[0], d[2], d[1]]; // in-plane 1, in-plane 2, out of plane
  const mag = Math.hypot(a, b, c);
  return { mag, alpha: (Math.atan2(b, a) * 180) / Math.PI, beta: mag > 0 ? (Math.asin(c / mag) * 180) / Math.PI : 0 };
}

export async function fitMissionBurns(dyn: Dyn, s0: number[], C: number, jdCross: number, horizonDays: number, burns: Burn[], M: Mission,
  onProgress?: (s: string) => void): Promise<{ burns: Burn[]; info: FitInfo[] }> {
  const fwd = burns.filter((b) => b.on && b.tDays > 0 && b.tDays < horizonDays).sort((a, b) => a.tDays - b.tDays);
  const out = burns.map((b) => ({ ...b }));
  const info: FitInfo[] = [];
  const tp = dyn.tPerTau, toT = (d: number) => (d / TSTAR_DAYS) * tp;
  let y: number[] = Array.from(dyn.init(s0)), t = 0; // model state and time (model units)
  const prop = (y0: number[], t0: number, t1: number) => {
    const r = propagate([], { y0, t0: t0 / tp, tEnd: Math.abs(t1 - t0) / tp, dir: t1 >= t0 ? 1 : -1, C, dyn, hMax: 0.01 });
    return r.status === 0 ? r.yEnd! : null;
  };
  // burns after the section act forward (fit the real position after each), burns before it act
  // backward from the section (fit the real position before each), as in runPlanAnchored
  const past = burns.filter((b) => b.on && b.tDays < 0 && b.tDays > -horizonDays).sort((a, b) => b.tDays - a.tDays);
  const total = fwd.length + past.length;
  let done = 0;
  for (const [list, sgn] of [[fwd, 1], [past, -1]] as [Burn[], number][]) {
    y = Array.from(dyn.init(s0)); t = 0;
    for (let k = 0; k < list.length; k++) {
      onProgress?.(`fitting maneuver ${++done} of ${total}…`);
      await new Promise((r) => setTimeout(r, 0));
      const b = list[k], tb = toT(b.tDays);
      const yb = prop(y, t, tb); // forward: state before the burn; backward: state after it
      if (!yb) break;
      // target: the real position some time away from the burn (past the finite burn, before the next one)
      const next = k + 1 < list.length ? list[k + 1].tDays : sgn * horizonDays;
      // (kept inside the data span when there is room for it)
      const d0 = M.jd[0] - jdCross + 0.01, d1 = M.jd[M.jd.length - 1] - jdCross - 0.01;
      let tgtDays = sgn > 0 ? Math.min(b.tDays + 2, next - 0.05, horizonDays - 0.01) : Math.max(b.tDays - 2, next + 0.05, -horizonDays + 0.01);
      if (sgn > 0 && tgtDays > d1 && d1 > b.tDays + 0.1) tgtDays = d1;
      if (sgn < 0 && tgtDays < d0 && d0 < b.tDays - 0.1) tgtDays = d0;
      const X = missionStateAt(M, jdCross + tgtDays);
      const detected = b.mag;
      let d = dvComponents(b.frame, b.mag, b.alpha, b.beta) as V3;
      let miss = Infinity, ok = false;
      const across = (dd: V3) => Array.from(applyDv(dyn, tb, yb, b.frame, sgn > 0 ? dd : (dd.map((v) => -v) as V3)).y);
      const res = (dd: V3) => {
        const yt = prop(across(dd), tb, toT(tgtDays));
        return yt && X ? [yt[0] - X[0], yt[1] - X[1], yt[2] - X[2]] : null;
      };
      if (X && Math.abs(tgtDays - b.tDays) > 0.01) {
        let r = res(d);
        for (let it = 0; it < 12 && r; it++) {
          miss = Math.hypot(r[0], r[1], r[2]);
          if (miss < 0.05) { ok = true; break; }
          // Jacobian d r / d dv by central differences (0.01 m/s)
          const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], h = 0.01;
          let bad = false;
          for (let j = 0; j < 3; j++) {
            const p = [...d] as V3, m = [...d] as V3; p[j] += h; m[j] -= h;
            const rp = res(p), rm = res(m);
            if (!rp || !rm) { bad = true; break; }
            for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
          }
          if (bad) break;
          const step = solve(J, r);
          // damped update: halve until the miss decreases
          let lam = 1, improved = false;
          for (let q = 0; q < 8; q++) {
            const dn = [d[0] - lam * step[0], d[1] - lam * step[1], d[2] - lam * step[2]] as V3;
            const rn = res(dn);
            if (rn && Math.hypot(rn[0], rn[1], rn[2]) < miss) { d = dn; r = rn; improved = true; break; }
            lam *= 0.5;
          }
          if (!improved) break;
          miss = Math.hypot(r![0], r![1], r![2]);
          ok = miss < 1;
        }
      }
      const pz = polar(b.frame, d);
      const o = out.find((x) => x.id === b.id)!;
      Object.assign(o, { mag: +pz.mag.toFixed(4), alpha: +pz.alpha.toFixed(3), beta: +pz.beta.toFixed(3) });
      // no real position to aim at (the data end before the target): a jump there is usually
      // entry / data noise, not a maneuver, so switch it off
      if (!X) o.on = false;
      info.push({ id: b.id, detected, fitted: pz.mag, missKm: miss, targetDays: tgtDays, ok, noData: !X } as FitInfo);
      y = o.on ? across(dvComponents(o.frame, o.mag, o.alpha, o.beta) as V3) : Array.from(yb); t = tb;
    }
  }
  return { burns: out, info };
}

function solve(A: number[][], b: number[]): V3 {
  const d = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = d(A) || 1e-300;
  const col = (j: number) => A.map((r, i) => r.map((x, k) => (k === j ? b[i] : x)));
  return [d(col(0)) / D, d(col(1)) / D, d(col(2)) / D];
}
