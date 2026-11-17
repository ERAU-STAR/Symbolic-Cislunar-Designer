import { REGIME_THRESHOLDS, regimeIndex, C_L1, C_L2, C_L3 } from '../core/constants';
import { COLORS, NAMES, css, textOn } from '../core/symbols';

export const C_MIN = 0, C_MAX = 3.25;
// the track is non-linear: the upper 80 % covers 3.25 .. 2.95 (where the graph changes), the lower 20 % 2.95 .. 0
const C_KNEE = 2.95, F_KNEE = 0.8;
const fracOf = (c: number) => (c >= C_KNEE ? ((C_MAX - c) / (C_MAX - C_KNEE)) * F_KNEE : F_KNEE + ((C_KNEE - c) / (C_KNEE - C_MIN)) * (1 - F_KNEE));
const cOf = (f: number) => (f <= F_KNEE ? C_MAX - (f / F_KNEE) * (C_MAX - C_KNEE) : C_KNEE - ((f - F_KNEE) / (1 - F_KNEE)) * (C_KNEE - C_MIN));

/** symbol name with subscript, e.g. M_T1 -> M<sub>T1</sub> (also accepts coarse names / starred) */
export function Sym({ name }: { name: string }) {
  const star = name.endsWith('*');
  const [m, s] = name.replace('*', '').split('_');
  return (
    <span className="sym">
      {m}
      {s && <sub>{s}</sub>}
      {star && <sup>★</sup>}
    </span>
  );
}

export function Chip({ id, n, onClick }: { id: number; n?: number; onClick?: () => void }) {
  return (
    <span className="chip" style={{ background: css(COLORS[id]), color: textOn(COLORS[id]) }} onClick={onClick}>
      {n !== undefined && <b className="chip-n">{n}</b>}
      <Sym name={NAMES[id]} />
    </span>
  );
}

const TICK_NAMES = ['L1', 'L2', '', '', '', 'L3', '', ''];

/** vertical Jacobi-constant slider with the graph-regime thresholds of Table 1 */
export function CSlider({ C, onChange }: { C: number; onChange: (c: number) => void }) {
  const frac = fracOf; // top = high C
  const k = regimeIndex(C);
  return (
    <div className="cslider">
      <div className="cslider-head">
        <div className="clabel">C</div>
        <input type="number" step={0.0001} min={C_MIN} max={C_MAX} value={+C.toFixed(4)}
          onChange={(e) => { const v = +e.target.value; if (isFinite(v)) onChange(Math.min(C_MAX, Math.max(C_MIN, v))); }} />
        <div className="regime">G<sup>({k})</sup></div>
      </div>
      <div className="cslider-track">
        <input type="range" min={0} max={1000} value={Math.round(1000 * frac(C))}
          onChange={(e) => onChange(+cOf(+e.target.value / 1000).toFixed(4))}
          aria-label="Jacobi constant" />
        {REGIME_THRESHOLDS.map((t, q) => {
          // stagger labels of thresholds that sit almost on top of each other (3.0125 / C_L3)
          const close = q > 0 && frac(t) - frac(REGIME_THRESHOLDS[q - 1]) < 0.025;
          return (
            <div key={q} className="tick" style={{ top: `${100 * frac(t)}%` }}
              title={`G(${q + 2}) starts at C = ${t.toFixed(6)}`}
              onClick={() => onChange(t - 1e-6)}>
              <span style={close ? { top: 2 } : undefined}>{TICK_NAMES[q] ? `${TICK_NAMES[q]} ${t.toFixed(4)}` : t.toFixed(4)}</span>
            </div>
          );
        })}
        <div className="tick knee" style={{ top: `${100 * F_KNEE}%` }} title="below this line the scale is compressed (2.95 .. 0)"><span style={{ top: 3 }}>2.95 ▾ 0</span></div>
      </div>
    </div>
  );
}

export const CRIT = { C_L1, C_L2, C_L3 };
