import { useEffect, useMemo, useRef, useState } from 'react';
import { regionRaster, type View, type Raster } from '../core/partition';
import type { Piece } from '../core/boundary';
import { COLORS, NAMES } from '../core/symbols';
import {
  MU, X_EARTH, X_MOON, A_STAR, B_STAR, X_L1, X_L2, X_L3, L4, X_G, R_G, R_MOON, R_EARTH,
} from '../core/constants';

export const FULL_VIEW: View = { x0: -1.3, x1: 1.5, y0: -1.08, y1: 1.08 };
export const MOON_VIEW: View = { x0: 0.58, x1: 1.4, y0: -0.56, y1: 0.56 };

interface Props {
  C: number;
  word?: number[];
  allowed?: Set<number> | null; // next admissible regions (others are dimmed)
  onPick?: (id: number) => void;
  /** start = index of the section point (past before it); breaks = first index of each segment after a burn;
   *  ghost = reference trajectory drawn faintly (e.g. without the burns) */
  traj?: { x: number[]; y: number[]; start?: number; breaks?: number[]; breakLabels?: string[]; ghost?: { x: number[]; y: number[] } } | null;
  section?: Piece | null; // boundary piece to highlight
  marker?: [number, number] | null;
  initialView?: View;
  /** reference curve (e.g. a real mission), drawn in purple under the trajectory */
  overlay?: { x: number[]; y: number[] } | null;
}

/** fit the requested view to the canvas aspect ratio (equal axes) */
function fitView(v: View, w: number, h: number): View {
  const cx = 0.5 * (v.x0 + v.x1), cy = 0.5 * (v.y0 + v.y1);
  let sx = v.x1 - v.x0, sy = v.y1 - v.y0;
  if (sx / sy > w / h) sy = (sx * h) / w;
  else sx = (sy * w) / h;
  return { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
}

export function RegionView({ C, word = [], allowed = null, onPick, traj = null, marker = null, initialView = FULL_VIEW, section = null, overlay = null }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 450 });
  const [view, setView] = useState<View>(initialView);
  const fitted = useMemo(() => fitView(view, size.w, size.h), [view, size]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(50, el.clientWidth), h: Math.max(50, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // raster (debounced by animation frame)
  const [raster, setRaster] = useState<Raster | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const scale = Math.min(1.25, 900 / Math.max(size.w, size.h));
      setRaster(regionRaster(fitted, Math.round(size.w * scale), Math.round(size.h * scale), C));
    });
    return () => cancelAnimationFrame(id);
  }, [fitted, size, C]);

  // draw
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !raster) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { nx, ny, label, w } = raster;
    const img = new ImageData(nx, ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, o = ((ny - 1 - j) * nx + i) * 4;
        const lab = label[k];
        let c: readonly number[] = [1, 1, 1];
        if (lab) {
          c = COLORS[lab];
          if (allowed && !allowed.has(lab)) c = [c[0] * 0.35 + 0.62, c[1] * 0.35 + 0.62, c[2] * 0.35 + 0.62];
        }
        // ZVC outline: accessible pixel next to a forbidden one
        const edge = lab && ((i > 0 && w[k - 1] < C) || (i < nx - 1 && w[k + 1] < C) || (j > 0 && w[k - nx] < C) || (j < ny - 1 && w[k + nx] < C));
        if (edge) c = [0.2, 0.2, 0.2];
        img.data[o] = c[0] * 255; img.data[o + 1] = c[1] * 255; img.data[o + 2] = c[2] * 255; img.data[o + 3] = 255;
      }
    }
    const off = new OffscreenCanvas(nx, ny);
    off.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, size.w, size.h);
    g.drawImage(off, 0, 0, size.w, size.h);

    const v = fitted;
    const X = (x: number) => ((x - v.x0) / (v.x1 - v.x0)) * size.w;
    const Y = (y: number) => size.h - ((y - v.y0) / (v.y1 - v.y0)) * size.h;
    const S = (d: number) => (d / (v.x1 - v.x0)) * size.w;
    const line = (pts: [number, number][], dash: number[] = [], col = 'rgba(40,40,40,0.9)', lw = 1) => {
      g.beginPath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = lw;
      pts.forEach(([x, y], q) => (q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.stroke(); g.setLineDash([]);
    };
    const th = Array.from({ length: 361 }, (_, q) => (q * Math.PI) / 180);
    // partition boundaries
    line(th.map((t) => [X_G + R_G * Math.cos(t), R_G * Math.sin(t)]), [5, 4]);
    line(th.map((t) => [X_MOON + A_STAR * Math.cos(t), B_STAR * Math.sin(t)]), [], 'rgba(20,20,20,1)', 1.4);
    for (const xc of [X_L1, X_MOON, X_L2]) {
      const yy = B_STAR * Math.sqrt(Math.max(0, 1 - ((xc - X_MOON) / A_STAR) ** 2));
      line([[xc, -yy], [xc, yy]]);
    }
    line([[X_L1, 0], [X_L2, 0]]);
    line([[X_EARTH, 0], [L4[0], L4[1]]]);
    line([[X_EARTH, 0], [L4[0], -L4[1]]]);
    line([[X_G - R_G, 0], [X_EARTH, 0]]);
    line([[X_MOON + A_STAR, 0], [v.x1 + 1, 0]]);
    const yTop = Math.sqrt(Math.max(0, R_G * R_G - X_G * X_G));
    line([[0, yTop], [0, v.y1 + 1]]);
    line([[0, -yTop], [0, v.y0 - 1]]);
    // bodies and libration points
    g.fillStyle = '#5a0000'; g.beginPath(); g.arc(X(X_EARTH), Y(0), Math.max(3, S(R_EARTH)), 0, 7); g.fill();
    g.fillStyle = '#8c8c8c'; g.beginPath(); g.arc(X(X_MOON), Y(0), Math.max(2.5, S(R_MOON)), 0, 7); g.fill();
    const star = (x: number, y: number, col: string) => {
      g.fillStyle = col; g.beginPath();
      for (let q = 0; q < 10; q++) {
        const r = q % 2 ? 2.6 : 6.5, a = -Math.PI / 2 + (q * Math.PI) / 5;
        const px = X(x) + r * Math.cos(a), py = Y(y) + r * Math.sin(a);
        q ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    };
    star(X_L1, 0, '#e11d48'); star(X_L2, 0, '#d946ef');
    star(X_L3, 0, '#333'); star(L4[0], L4[1], '#333'); star(L4[0], -L4[1], '#333');

    // region labels at the accessible pixel nearest to each label's centroid
    const acc = new Map<number, [number, number, number]>();
    for (let k = 0; k < label.length; k++) {
      const l = label[k]; if (!l) continue;
      const a = acc.get(l) ?? [0, 0, 0];
      a[0] += k % nx; a[1] += Math.floor(k / nx); a[2]++;
      acc.set(l, a);
    }
    const pos = new Map<number, [number, number]>();
    for (const [l, [sx, sy, n]] of acc) {
      if (n < 12 && l !== 11) continue;
      const cx = sx / n, cy = sy / n;
      let best = -1, bd = Infinity;
      for (let k = 0; k < label.length; k += 3) {
        if (label[k] !== l) continue;
        const d = (k % nx - cx) ** 2 + (Math.floor(k / nx) - cy) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) pos.set(l, [v.x0 + ((best % nx) / (nx - 1)) * (v.x1 - v.x0), v.y0 + (Math.floor(best / nx) / (ny - 1)) * (v.y1 - v.y0)]);
    }
    g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [l, [x, y]] of pos) {
      if (l === 11 || l === 5) continue;
      const [main, sub] = NAMES[l].split('_');
      g.fillStyle = '#111';
      g.fillText(main, X(x) - 4, Y(y));
      g.font = '600 9px system-ui, sans-serif'; g.fillText(sub, X(x) + 5 + (sub.length - 1) * 2.5, Y(y) + 4);
      g.font = '600 12px system-ui, sans-serif';
    }
    // word order badges
    word.forEach((id, q) => {
      const p = pos.get(id); if (!p) return;
      const bx = X(p[0]) + 12 + 7 * (word.slice(0, q).filter((w2) => w2 === id).length), by = Y(p[1]) - 12;
      g.fillStyle = '#0f172a'; g.beginPath(); g.arc(bx, by, 8, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = '700 10px system-ui'; g.fillText(String(q + 1), bx, by + 0.5);
    });
    // section boundary piece
    if (section) {
      const n = 200;
      g.beginPath(); g.strokeStyle = '#16a34a'; g.lineWidth = 5; g.globalAlpha = 0.85;
      for (let q = 0; q <= n; q++) {
        const [x, y] = section.shape.pt(section.s0 + ((section.s1 - section.s0) * q) / n);
        q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y));
      }
      g.stroke(); g.globalAlpha = 1;
    }
    if (overlay && overlay.x.length > 1) {
      g.strokeStyle = 'rgba(147, 51, 234, 0.85)'; g.lineWidth = 1.3;
      g.beginPath();
      let pen = false;
      for (let q = 0; q < overlay.x.length; q++) {
        const x = overlay.x[q], y = overlay.y[q];
        if (!Number.isFinite(x)) { pen = false; continue; }
        if (pen) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); pen = true; }
      }
      g.stroke(); g.lineWidth = 1;
    }
    // trajectory overlay: past (grey dashed) before the section point, future solid
    if (traj && traj.x.length > 1) {
      const k0 = Math.min(traj.start ?? 0, traj.x.length - 1);
      const seg = (a: number, b: number) => { g.beginPath(); for (let q = a; q <= b; q++) q === a ? g.moveTo(X(traj.x[q]), Y(traj.y[q])) : g.lineTo(X(traj.x[q]), Y(traj.y[q])); g.stroke(); };
      if (k0 > 0) { g.strokeStyle = '#6b7280'; g.lineWidth = 1.4; g.setLineDash([5, 3]); seg(0, k0); g.setLineDash([]); }
      if (traj.ghost && traj.ghost.x.length > 1) {
        const G = traj.ghost;
        g.strokeStyle = 'rgba(100, 116, 139, 0.55)'; g.lineWidth = 1.2; g.setLineDash([2, 3]);
        g.beginPath(); G.x.forEach((x, q) => (q ? g.lineTo(X(x), Y(G.y[q])) : g.moveTo(X(x), Y(G.y[q])))); g.stroke(); g.setLineDash([]);
      }
      const br = (traj.breaks ?? []).filter((b) => b > k0 && b < traj.x.length);
      const brLab = (traj.breaks ?? []).map((b, q) => [b, traj.breakLabels?.[q]] as const).filter(([b]) => b > k0 && b < traj.x.length).map(([, l]) => l);
      const SEG_COL = ['#000000', '#1d4ed8', '#c2410c', '#15803d', '#7e22ce', '#be123c', '#0e7490'];
      const cuts = [k0, ...br, traj.x.length - 1];
      for (let q = 0; q + 1 < cuts.length; q++) { g.strokeStyle = SEG_COL[q % SEG_COL.length]; g.lineWidth = 1.6; seg(Math.max(k0, cuts[q] - (q ? 1 : 0)), cuts[q + 1]); }
      g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.beginPath(); g.arc(X(traj.x[k0]), Y(traj.y[k0]), 4, 0, 7); g.fill(); g.stroke();
      // burn markers (red triangles)
      br.forEach((b, q) => {
        const x = X(traj.x[b - 1] ?? traj.x[b]), y = Y(traj.y[b - 1] ?? traj.y[b]);
        g.fillStyle = '#dc2626'; g.strokeStyle = '#fff'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y + 4.5); g.lineTo(x - 6, y + 4.5); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#111'; g.font = '600 11px system-ui'; g.fillText(brLab[q] ?? `Δv${q + 1}`, x + 7, y - 6);
      });
    }
    if (marker) {
      g.fillStyle = '#f59e0b'; g.strokeStyle = '#000'; g.beginPath(); g.arc(X(marker[0]), Y(marker[1]), 5.5, 0, 7); g.fill(); g.stroke();
    }
  }, [raster, size, fitted, word, allowed, traj, marker, C, section, overlay]);

  // interaction: drag = pan, wheel/pinch = zoom, tap = pick
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; dist: number } | null>(null);
  const toWorld = (px: number, py: number) => ({
    x: fitted.x0 + (px / size.w) * (fitted.x1 - fitted.x0),
    y: fitted.y0 + ((size.h - py) / size.h) * (fitted.y1 - fitted.y0),
  });
  const zoomAt = (px: number, py: number, f: number) => {
    const p = toWorld(px, py);
    setView({ x0: p.x + (fitted.x0 - p.x) * f, x1: p.x + (fitted.x1 - p.x) * f, y0: p.y + (fitted.y0 - p.y) * f, y1: p.y + (fitted.y1 - p.y) * f });
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div className="region-view" ref={wrap}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h, touchAction: 'none' }}
        onWheel={(e) => { const p = local(e); zoomAt(p.x, p.y, e.deltaY > 0 ? 1.15 : 1 / 1.15); }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          ptrs.current.set(e.pointerId, local(e));
          const ps = [...ptrs.current.values()];
          gesture.current = { moved: false, dist: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0 };
        }}
        onPointerMove={(e) => {
          const prev = ptrs.current.get(e.pointerId);
          if (!prev || !gesture.current) return;
          const cur = local(e);
          ptrs.current.set(e.pointerId, cur);
          const ps = [...ptrs.current.values()];
          if (ps.length === 2) {
            const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
            if (gesture.current.dist > 0) zoomAt((ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2, gesture.current.dist / d);
            gesture.current = { moved: true, dist: d };
            return;
          }
          const dx = cur.x - prev.x, dy = cur.y - prev.y;
          if (Math.abs(dx) + Math.abs(dy) > 0.5) {
            if (!gesture.current.moved && Math.hypot(dx, dy) < 3) return;
            gesture.current.moved = true;
            const sx = (fitted.x1 - fitted.x0) / size.w;
            setView({ x0: fitted.x0 - dx * sx, x1: fitted.x1 - dx * sx, y0: fitted.y0 + dy * sx, y1: fitted.y1 + dy * sx });
          }
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          ptrs.current.delete(e.pointerId);
          if (ptrs.current.size === 0) gesture.current = null;
          if (g && !g.moved && onPick && raster) {
            const p = local(e);
            const i = Math.round((p.x / size.w) * (raster.nx - 1)), j = Math.round(((size.h - p.y) / size.h) * (raster.ny - 1));
            const lab = raster.label[j * raster.nx + i];
            if (lab) onPick(lab);
          }
        }}
      />
      <div className="view-buttons">
        <button onClick={() => setView(FULL_VIEW)} title="Earth-Moon view">Earth–Moon</button>
        <button onClick={() => setView(MOON_VIEW)} title="Lunar region">Moon</button>
      </div>
    </div>
  );
}

export { MU };
