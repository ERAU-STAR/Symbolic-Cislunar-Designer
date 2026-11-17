// 3D trajectory viewer (three.js): rotating (pulsating) frame with the zero-velocity
// surface and the partition's cylinder boundaries, or the inertial frame with the
// Moon's path and the Sun direction. Rendered on demand (no animation loop).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MU, X_MOON, X_EARTH, X_L1, X_L2, X_L3, L4, X_G, R_G, A_STAR, B_STAR, R_EARTH, R_MOON, twoU } from '../core/constants';
import { classify } from '../core/partition';
import { COLORS } from '../core/symbols';
import type { Piece } from '../core/boundary';
import type { Inertial } from '../core/models';

type Frame = 'rot' | 'inertial';
type ViewKey = 'persp' | 'top' | 'side' | 'front';

interface Props {
  P: number[][]; // pulsating-frame states (past reversed + future)
  I: Inertial[];
  start: number; // index of the section crossing ("now")
  upto: number; // scrubber index
  C: number;
  piece: Piece | null;
  zSec: number; // z of the section point
  breaks?: number[]; // first sample after each burn
}

/** zero-velocity surface 2U(x, y, z) = C as the two height fields z = +-zmax(x, y) over the
 *  in-plane allowed region; triangles are clipped at the in-plane ZVC (z = 0) and at the display
 *  cap |z| = zcap so the surface ends cleanly instead of in grid steps. */
export function zvsGeometry(C: number, ext = 1.6, N = 241, zcap = 0.55): THREE.BufferGeometry {
  const X = (i: number) => -ext + (2 * ext * i) / (N - 1);
  const f = new Float32Array(N * N), h = new Float32Array(N * N), zm = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X(i), y = X(j), k = j * N + i;
    f[k] = twoU(x, y, 0) - C; // >= 0: allowed in the plane
    h[k] = C - twoU(x, y, zcap); // >= 0: surface below the cap
    if (f[k] < 0 || h[k] < 0) continue;
    let a = 0, b = zcap;
    for (let it = 0; it < 30; it++) { const m = 0.5 * (a + b); if (twoU(x, y, m) >= C) a = m; else b = m; }
    zm[k] = 0.5 * (a + b);
  }
  type V = { x: number; y: number; z: number; f: number; h: number };
  const clip = (poly: V[], key: 'f' | 'h', zOn: (v: V) => number): V[] => {
    const out: V[] = [];
    for (let q = 0; q < poly.length; q++) {
      const A = poly[q], B = poly[(q + 1) % poly.length], ina = A[key] >= 0, inb = B[key] >= 0;
      if (ina) out.push(A);
      if (ina !== inb) {
        const t = A[key] / (A[key] - B[key]);
        const v: V = { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y), z: 0, f: A.f + t * (B.f - A.f), h: A.h + t * (B.h - A.h) };
        v[key] = 0;
        v.z = zOn(v);
        out.push(v);
      }
    }
    return out;
  };
  const pos: number[] = [];
  const vert = (k: number): V => ({ x: X(k % N), y: X(Math.floor(k / N)), z: zm[k], f: f[k], h: h[k] });
  const tri = (a: number, b: number, c: number) => {
    if (f[a] < 0 && f[b] < 0 && f[c] < 0) return;
    if (h[a] < 0 && h[b] < 0 && h[c] < 0) return;
    let poly = [vert(a), vert(b), vert(c)];
    if (f[a] < 0 || f[b] < 0 || f[c] < 0) poly = clip(poly, 'f', () => 0);
    if (h[a] < 0 || h[b] < 0 || h[c] < 0) poly = clip(poly, 'h', () => zcap);
    for (let q = 1; q + 1 < poly.length; q++) for (const v of [poly[0], poly[q], poly[q + 1]]) pos.push(v.x, v.y, v.z);
  };
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    tri(a, b, d); tri(a, d, c);
  }
  const n = pos.length;
  for (let q = 0; q < n; q += 9) pos.push(pos[q], pos[q + 1], -pos[q + 2], pos[q + 6], pos[q + 7], -pos[q + 8], pos[q + 3], pos[q + 4], -pos[q + 5]);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}

const symColor = (x: number, y: number, C: number): [number, number, number] => COLORS[classify(x, y, C)] ?? [0.1, 0.1, 0.1];
function darker(c: [number, number, number]): [number, number, number] {
  // light symbol colours (X_T, E_T, ...) need some depth on a light background
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return l > 0.7 ? (c.map((v) => v * 0.78) as [number, number, number]) : c;
}

function curve(pts: number[][], color: number, width: number, opacity = 1, dashed = false): Line2 {
  const g = new LineGeometry();
  g.setPositions(pts.flat());
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, dashed, dashSize: 0.02, gapSize: 0.015 });
  const l = new Line2(g, m);
  if (dashed) l.computeLineDistances();
  return l;
}
function ring(f: (t: number) => number[], n = 240, t0 = 0, t1 = 2 * Math.PI) {
  return Array.from({ length: n + 1 }, (_, q) => f(t0 + ((t1 - t0) * q) / n));
}
function dispose(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}
const sphere = (r: number, color: number, at: number[]) => {
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  s.position.set(at[0], at[1], at[2]);
  return s;
};
/** screen-size dot (visible even when the body is tiny) */
const dot = (color: number, at: number[], size = 9) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
};

const keep = { frame: 'rot' as Frame, zvs: true, bnd: true, center: 'em' as 'moon' | 'em' };

export function Traj3D({ P, I, start, upto, C, piece, zSec, breaks = [] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const R = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls; render: () => void; world: THREE.Group; traj: THREE.Group; mark: THREE.Group; mats: LineMaterial[] } | null>(null);
  // settings survive model / epoch switches (the viewer is remounted while a model loads)
  const [frame, setFrame] = useState<Frame>(keep.frame);
  const [showZvs, setShowZvs] = useState(keep.zvs);
  const [showBnd, setShowBnd] = useState(keep.bnd);
  const [center, setCenter] = useState<'moon' | 'em'>(keep.center);
  useEffect(() => { Object.assign(keep, { frame, zvs: showZvs, bnd: showBnd, center }); }, [frame, showZvs, showBnd, center]);
  const [err, setErr] = useState('');

  // ---- renderer, camera, controls (once)
  useEffect(() => {
    const el = wrap.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setErr('WebGL is not available in this browser.'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0xf7f8fa);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, -2, 3); scene.add(dl);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.001, 50);
    cam.up.set(0, 0, 1);
    const ctl = new OrbitControls(cam, renderer.domElement);
    const world = new THREE.Group(), traj = new THREE.Group(), mark = new THREE.Group();
    scene.add(world, traj, mark);
    const mats: LineMaterial[] = [];
    const render = () => renderer.render(scene, cam);
    ctl.addEventListener('change', render);
    const ro = new ResizeObserver(() => {
      const w = Math.max(200, el.clientWidth), h = Math.max(260, el.clientHeight);
      renderer.setSize(w, h);
      cam.aspect = w / h; cam.updateProjectionMatrix();
      scene.traverse((o) => { const m = (o as Line2).material; if (m instanceof LineMaterial) m.resolution.set(w, h); });
      render();
    });
    ro.observe(el);
    R.current = { renderer, scene, cam, ctl, render, world, traj, mark, mats };
    return () => { ro.disconnect(); ctl.dispose(); dispose(scene); renderer.dispose(); el.removeChild(renderer.domElement); R.current = null; };
  }, []);

  const zvs = useMemo(() => (frame === 'rot' && showZvs ? zvsGeometry(C) : null), [frame, showZvs, C]);
  const resize = () => {
    const r = R.current!, el = wrap.current!;
    const w = Math.max(200, el.clientWidth), h = Math.max(260, el.clientHeight);
    r.scene.traverse((o) => { const m = (o as Line2).material; if (m instanceof LineMaterial) m.resolution.set(w, h); });
  };

  // ---- static world: bodies, L points, boundaries, ZVS
  useEffect(() => {
    const r = R.current; if (!r) return;
    dispose(r.world); r.world.clear();
    const W = r.world;
    if (frame === 'rot') {
      W.add(sphere(R_EARTH, 0x2f5f9e, [X_EARTH, 0, 0]), dot(0x2f5f9e, [X_EARTH, 0, 0], 8));
      W.add(sphere(R_MOON, 0x8c8c8c, [X_MOON, 0, 0]), dot(0x6b6b6b, [X_MOON, 0, 0], 6));
      for (const p of [[X_L1, 0, 0], [X_L2, 0, 0], [X_L3, 0, 0], [L4[0], L4[1], 0], [L4[0], -L4[1], 0]]) W.add(dot(0xbe185d, p, 6));
      const grid = new THREE.GridHelper(3.2, 32, 0xd4d7dd, 0xe6e8ec); grid.rotation.x = Math.PI / 2; W.add(grid);
      if (showBnd) {
        const H = 0.25;
        // lunar ellipse and the L3-L4-L5 circle, at z = 0 and as faint cylinders
        const ell = (t: number, z = 0) => [X_MOON + A_STAR * Math.cos(t), B_STAR * Math.sin(t), z];
        W.add(curve(ring((t) => ell(t)), 0x2563eb, 1.6, 0.9));
        for (const z of [-H, H]) W.add(curve(ring((t) => ell(t, z)), 0x2563eb, 1, 0.3));
        for (let q = 0; q < 12; q++) { const t = (q * Math.PI) / 6; W.add(curve([ell(t, -H), ell(t, H)], 0x2563eb, 1, 0.22)); }
        W.add(curve(ring((t) => [X_G + R_G * Math.cos(t), R_G * Math.sin(t), 0]), 0xb45309, 1.4, 0.7));
        W.add(curve([[X_L1, -0.6, 0], [X_L1, 0.6, 0]], 0x9ca3af, 1, 0.6, true), curve([[X_L2, -0.6, 0], [X_L2, 0.6, 0]], 0x9ca3af, 1, 0.6, true));
        if (piece) {
          const n = 120, pts = Array.from({ length: n + 1 }, (_, q) => [...piece.shape.pt(piece.s0 + ((piece.s1 - piece.s0) * q) / n), zSec]);
          W.add(curve(pts, 0x16a34a, 4));
        }
      }
      if (zvs) {
        const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9 });
        const mesh = new THREE.Mesh(zvs, mat); mesh.renderOrder = 1; W.add(mesh);
      }
    } else {
      W.add(sphere(R_EARTH, 0x2f5f9e, [0, 0, 0]), dot(0x2f5f9e, [0, 0, 0], 8));
      const grid = new THREE.GridHelper(3.2, 32, 0xd4d7dd, 0xe6e8ec); grid.rotation.x = Math.PI / 2; W.add(grid);
    }
    resize();
    r.render();
  }, [frame, showBnd, zvs, piece, zSec]);

  // per-point symbol colours (from the rotating frame, also used in the inertial view)
  const cols = useMemo(() => P.map((p) => darker(symColor(p[0], p[1], C))), [P, C]);

  // ---- trajectory + Moon path (rebuilt when the scrubber moves; a few thousand points)
  useEffect(() => {
    const r = R.current; if (!r) return;
    dispose(r.traj); r.traj.clear(); dispose(r.mark); r.mark.clear();
    const pts = frame === 'rot' ? P.map((p) => [p[0], p[1], p[2] ?? 0]) : I.map((q) => q.sc);
    const k = Math.min(upto, pts.length - 1), s0 = Math.min(start, k);
    if (s0 > 0) r.traj.add(curve(pts.slice(0, s0 + 1), 0x6b7280, 1.6, 0.9, true));
    if (k > s0) {
      const g = new LineGeometry();
      g.setPositions(pts.slice(s0, k + 1).flat());
      g.setColors(cols.slice(s0, k + 1).flat());
      r.traj.add(new Line2(g, new LineMaterial({ vertexColors: true, linewidth: 2.6, transparent: true, opacity: 1 })));
    }
    r.mark.add(dot(0xf59e0b, pts[k], 11), dot(0x16a34a, pts[s0], 8));
    for (const b of breaks) if (b - 1 <= k && b - 1 >= 0) r.mark.add(dot(0xdc2626, pts[b - 1], 12));
    r.traj.traverse((o) => { o.renderOrder = 2; });
    if (frame === 'inertial' && I.length) {
      r.traj.add(curve(I.slice(0, k + 1).map((q) => q.moon), 0x9aa3b2, 1.2, 0.9, true));
      const m = I[k].moon;
      r.mark.add(sphere(R_MOON, 0x8c8c8c, m), dot(0x6b6b6b, m, 7));
      const sun = I[k].sun;
      if (sun) {
        const d = new THREE.Vector3(...sun).normalize();
        const a = d.clone().multiplyScalar(1.1), b = d.clone().multiplyScalar(1.35);
        r.mark.add(curve([a.toArray(), b.toArray()], 0xd97706, 4));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 20), new THREE.MeshBasicMaterial({ color: 0xd97706 }));
        cone.position.copy(d.clone().multiplyScalar(1.4));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        r.mark.add(cone);
      }
    }
    resize();
    r.render();
  }, [P, I, start, upto, frame, cols, breaks.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- camera presets
  const setView = (v: ViewKey) => {
    const r = R.current; if (!r) return;
    const tgt = frame === 'inertial' ? new THREE.Vector3(0, 0, 0) : center === 'moon' ? new THREE.Vector3(X_MOON, 0, 0) : new THREE.Vector3(0.5 - MU, 0, 0);
    const d = frame === 'inertial' ? 5.2 : center === 'moon' ? 1.6 : 3.6;
    const dir = v === 'top' ? [0, -0.0001, 1] : v === 'side' ? [0, -1, 0] : v === 'front' ? [1, 0, 0] : [0.55, -1, 0.65];
    const u = new THREE.Vector3(...dir).normalize().multiplyScalar(d);
    r.cam.position.copy(tgt).add(u);
    r.ctl.target.copy(tgt);
    r.ctl.update();
    r.render();
  };
  useEffect(() => { setView('persp'); }, [frame, center]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="three-wrap">
      <div ref={wrap} className="three-canvas" />
      {err && <div className="empty">{err}</div>}
      <div className="three-ctl">
        <div className="seg">
          <button className={frame === 'rot' ? 'on' : ''} onClick={() => setFrame('rot')}>Rotating</button>
          <button className={frame === 'inertial' ? 'on' : ''} onClick={() => setFrame('inertial')}>Inertial</button>
        </div>
        <div className="seg">
          {(['persp', 'top', 'side', 'front'] as ViewKey[]).map((v) => <button key={v} onClick={() => setView(v)}>{v === 'persp' ? '3D' : v === 'top' ? 'x–y' : v === 'side' ? 'x–z' : 'y–z'}</button>)}
        </div>
        {frame === 'rot' && <div className="seg">
          <button className={center === 'moon' ? 'on' : ''} onClick={() => setCenter('moon')}>Moon</button>
          <button className={center === 'em' ? 'on' : ''} onClick={() => setCenter('em')}>Earth–Moon</button>
        </div>}
        {frame === 'rot' && <label className="switch small"><input type="checkbox" checked={showZvs} onChange={(e) => setShowZvs(e.target.checked)} /> zero-velocity surface</label>}
        {frame === 'rot' && <label className="switch small"><input type="checkbox" checked={showBnd} onChange={(e) => setShowBnd(e.target.checked)} /> boundaries</label>}
      </div>
      <div className="three-note small dim">
        {frame === 'rot'
          ? `Rotating frame (pulsating units). Colour = symbol region; grey dashed = past; green = section. Surface: 2U = ${C.toFixed(4)} (CR3BP reference, capped at |z| = 0.55). Drag to rotate, scroll / pinch to zoom, right-drag to pan.`
          : 'Inertial, Earth-centred, epoch Earth–Moon plane (Moon on +x at the start). Dashed = Moon path; orange arrow = Sun direction.'}
      </div>
    </div>
  );
}
