import { ALL_IDS, COLORS, NODE_POS, NAMES, css, textOn, type GraphState } from '../core/symbols';

interface Props {
  graph: GraphState;
  word: number[];
  allowed: Set<number> | null;
  onPick: (id: number) => void;
}

const R = 0.3;
const P = (id: number) => ({ x: NODE_POS[id][0], y: -NODE_POS[id][1] }); // svg y down

// move an end point from a node centre to its circle, towards a control point
function trim(A: { x: number; y: number }, Q: { x: number; y: number }, r = R + 0.02) {
  const d = Math.hypot(Q.x - A.x, Q.y - A.y) || 1;
  return { x: A.x + (r * (Q.x - A.x)) / d, y: A.y + (r * (Q.y - A.y)) / d };
}

function edgePath(a: number, b: number, active: Set<number>): string {
  const A0 = P(a), B0 = P(b);
  const key = [NAMES[a], NAMES[b]].sort().join('-');
  if (key === 'X_B-X_T') {
    const c1 = { x: 5.6, y: A0.y - 0.4 }, c2 = { x: 5.6, y: B0.y + 0.4 };
    const A = trim(A0, c1), B = trim(B0, c2);
    return `M${A.x},${A.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
  }
  // hand-routed edges that would otherwise run over a neighbouring node
  const ctrl: Record<string, [number, number]> = {
    'M_R-X_T': [4.15, 1.75], 'M_R-X_B': [4.15, -1.75], // outside M_T2 / M_B2
    'X_L-X_T': [-2.55, 2.0], 'X_B-X_L': [-2.55, -2.0], // outside E_T / E_B
  };
  const c = ctrl[key];
  if (c) {
    const Q = { x: c[0], y: -c[1] }, a2 = trim(A0, Q), b2 = trim(B0, Q);
    return `M${a2.x},${a2.y} Q${Q.x},${Q.y} ${b2.x},${b2.y}`;
  }
  const A = A0, B = B0;
  // bend edges that would pass through another node, away from the graph centre
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  let near = false;
  for (const id of ALL_IDS) {
    if (id === a || id === b || !active.has(id)) continue;
    const p = P(id), dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2));
    if (Math.hypot(A.x + t * dx - p.x, A.y + t * dy - p.y) < 0.42) near = true;
  }
  if (!near) { const a2 = trim(A, B), b2 = trim(B, A); return `M${a2.x},${a2.y} L${b2.x},${b2.y}`; }
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
  let nx = -dy / L, ny = dx / L;
  if ((mx - 0.7) * nx + my * ny < 0) { nx = -nx; ny = -ny; }
  const k = 0.75;
  const Q = { x: mx + k * nx, y: my + k * ny }, a2 = trim(A, Q), b2 = trim(B, Q);
  return `M${a2.x},${a2.y} Q${Q.x},${Q.y} ${b2.x},${b2.y}`;
}

function Label({ id, x, y }: { id: number; x: number; y: number }) {
  const [m, s] = NAMES[id].split('_');
  return (
    <text x={x} y={y + 0.07} textAnchor="middle" fontSize={0.24} fontWeight={700} fill={textOn(COLORS[id])} pointerEvents="none">
      {m}
      <tspan fontSize={0.15} dy={0.06}>{s}</tspan>
    </text>
  );
}

export function GraphView({ graph, word, allowed, onPick }: Props) {
  const onWord = new Set<string>();
  for (let q = 1; q < word.length; q++) onWord.add([word[q - 1], word[q]].sort().join('-'));
  return (
    <svg className="graph-view" viewBox="-3.1 -2.75 9.1 5.5" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.13" markerHeight="0.13" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#555" />
        </marker>
      </defs>
      {graph.edges.map((e) => {
        const hot = onWord.has([e.a, e.b].sort().join('-'));
        return (
          <path key={`${e.a}-${e.b}`} d={edgePath(e.a, e.b, graph.active)} fill="none"
            stroke={hot ? '#0f172a' : '#666'} strokeWidth={hot ? 0.07 : 0.025}
            markerStart="url(#arr)" markerEnd="url(#arr)" className="edge" />
        );
      })}
      {/* libration points on their true lines: L1/L2/L3 on the Earth-Moon axis, L4/L5 between E_T/E_B and E_R */}
      {([['L1', 1.6, 0], ['L2', 3.43, 0], ['L3', -1.98, 0], ['L4', -0.42, 1.0], ['L5', -0.42, -1.0]] as [string, number, number][]).map(([n, x, y]) => (
        <g key={n}>
          <text x={x} y={-y} fontSize={0.2} fill="#c81e1e" textAnchor="middle" dominantBaseline="central">★</text>
          <text x={x} y={-y + (y < 0 ? 0.2 : -0.2)} fontSize={0.14} fill="#c81e1e" textAnchor="middle" dominantBaseline="central">{n}</text>
        </g>
      ))}
      {ALL_IDS.map((id) => {
        const p = P(id);
        const act = graph.active.has(id);
        const ok = act && (!allowed || allowed.has(id));
        const order = word.map((w, q) => (w === id ? q + 1 : 0)).filter(Boolean);
        return (
          <g key={id} className="node" style={{ opacity: act ? (ok ? 1 : 0.3) : 0.08, cursor: ok ? 'pointer' : 'default' }}
            onClick={() => ok && onPick(id)}>
            <circle cx={p.x} cy={p.y} r={R} fill={css(COLORS[id])} stroke="#111" strokeWidth={0.025} />
            <Label id={id} x={p.x} y={p.y} />
            {order.length > 0 && (
              <g>
                <circle cx={p.x + R * 0.85} cy={p.y - R * 0.85} r={0.13} fill="#0f172a" />
                <text x={p.x + R * 0.85} y={p.y - R * 0.85 + 0.05} fontSize={0.13} textAnchor="middle" fill="#fff" fontWeight={700}>
                  {order.join(',')}
                </text>
              </g>
            )}
          </g>
        );
      })}
      <text x={-0.75} y={0.47} fontSize={0.15} fill="#c81e1e" textAnchor="middle">Earth</text>
      <text x={2.5} y={0.47} fontSize={0.15} fill="#c81e1e" textAnchor="middle">Moon</text>
    </svg>
  );
}
