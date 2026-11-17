// 3D symbolic map: a stack of adaptive 2D maps (one per layer of psi3 or z) shown as
// a voxel volume. "Boundaries" draws only voxels whose class differs from a neighbour
// (the 3D class boundaries); "Cloud" draws every voxel as a point. A highlighted legend
// entry is drawn solid with the rest as a faint cloud. The selected layer is shown as a
// textured plane. Clicking a voxel marks it (and selects its layer).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { displayIndex, type MapState, type PointResult } from '../core/mapEngine';
import type { Window } from '../core/boundary';
import type { Legend } from './palette';

export interface VoxelPick { u: number; v: number; w: number; k: number }

interface Props {
  layers: (MapState | null)[];
  vals: number[]; // layer values (psi3 [deg] or z)
  win: Window;
  legend: Legend | null;
  tick: number;
  layer: number;
  setLayer: (k: number) => void;
  labels: { u: string; v: string; w: string };
  mark: VoxelPick | null;
  onMark: (p: VoxelPick) => void;
}

const D_MAX = 49; // voxels per in-plane axis
const H = 0.8; // height of the box (w axis)

function textSprite(text: string, size = 0.045, color = '#1f2937') {
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  const f = 48;
  g.font = `${f}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 16;
  c.width = w; c.height = f + 16;
  g.font = `${f}px system-ui, sans-serif`; g.fillStyle = color; g.textBaseline = 'middle';
  g.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((size * w) / c.height, size, 1);
  sp.renderOrder = 10;
  return sp;
}
function dispose(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
    for (const mt of mats) { (mt as THREE.SpriteMaterial).map?.dispose(); mt.dispose(); }
  });
}
const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3));

const keep = { mode: 'shell' as 'shell' | 'cloud', plane: true, hideBg: true };

export function Volume3D({ layers, vals, win, legend, tick, layer, setLayer, labels, mark, onMark }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const R = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls; render: () => void; vox: THREE.Group; deco: THREE.Group; plane: THREE.Group } | null>(null);
  const [mode, setMode] = useState(keep.mode);
  const [plane, setPlane] = useState(keep.plane);
  const [hideBg, setHideBg] = useState(keep.hideBg);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  useEffect(() => { keep.mode = mode; keep.plane = plane; keep.hideBg = hideBg; }, [mode, plane, hideBg]);
  const K = vals.length;
  const zOf = (k: number) => (K > 1 ? (k / (K - 1) - 0.5) * H : 0);

  useEffect(() => {
    const el = wrap.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setErr('WebGL is not available in this browser.'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0xffffff);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2.0));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(1, -2, 3); scene.add(dl);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
    cam.up.set(0, 0, 1);
    cam.position.set(1.25, -1.75, 1.2);
    const ctl = new OrbitControls(cam, renderer.domElement);
    ctl.target.set(0, 0, 0); ctl.update();
    const vox = new THREE.Group(), deco = new THREE.Group(), plane = new THREE.Group();
    scene.add(vox, deco, plane);
    const render = () => renderer.render(scene, cam);
    ctl.addEventListener('change', render);
    const ro = new ResizeObserver(() => {
      const w = Math.max(200, el.clientWidth), h = Math.max(240, el.clientHeight);
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); render();
    });
    ro.observe(el);
    R.current = { renderer, scene, cam, ctl, render, vox, deco, plane };
    return () => { ro.disconnect(); ctl.dispose(); dispose(scene); renderer.dispose(); el.removeChild(renderer.domElement); R.current = null; };
  }, []);

  // ---- box, axes, labels
  useEffect(() => {
    const r = R.current; if (!r) return;
    dispose(r.deco); r.deco.clear();
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, H)), new THREE.LineBasicMaterial({ color: 0x9ca3af }));
    r.deco.add(box);
    const put = (sp: THREE.Sprite, x: number, y: number, z: number) => { sp.position.set(x, y, z); r.deco.add(sp); };
    put(textSprite(labels.u, 0.05), 0, -0.62, -H / 2);
    put(textSprite(fmt(win.p1a), 0.038, '#6b7280'), -0.5, -0.56, -H / 2);
    put(textSprite(fmt(win.p1b), 0.038, '#6b7280'), 0.5, -0.56, -H / 2);
    put(textSprite(labels.v, 0.05), 0.64, 0, -H / 2);
    put(textSprite(fmt(win.p2a), 0.038, '#6b7280'), 0.58, -0.5, -H / 2);
    put(textSprite(fmt(win.p2b), 0.038, '#6b7280'), 0.58, 0.5, -H / 2);
    if (K > 1) {
      put(textSprite(labels.w, 0.05), -0.62, -0.56, 0);
      put(textSprite(fmt(vals[0]), 0.038, '#6b7280'), -0.56, -0.56, -H / 2);
      put(textSprite(fmt(vals[K - 1]), 0.038, '#6b7280'), -0.56, -0.56, H / 2);
    }
    r.render();
  }, [labels.u, labels.v, labels.w, win.p1a, win.p1b, win.p2a, win.p2b, K, vals[0], vals[K - 1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- voxel lattice from the layers
  const grid = useMemo(() => {
    if (!legend) return null;
    const first = layers.find(Boolean);
    if (!first) return null;
    const n = first.n1, st = Math.max(1, Math.ceil((n - 1) / (D_MAX - 1))), D = Math.floor((n - 1) / st) + 1;
    const res: (PointResult | undefined)[] = new Array(D * D * K);
    const key = new Int32Array(D * D * K).fill(-1); // -1 = not computed
    const ids = new Map<string, number>();
    for (let k = 0; k < K; k++) {
      const s = layers[k]; if (!s) continue;
      for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
        const q = displayIndex(s, i * st, j * st), pr = q >= 0 ? s.res.get(q) : undefined;
        if (!pr) continue;
        const o = (k * D + j) * D + i, kk = legend.keyOf(pr);
        res[o] = pr;
        let id = ids.get(kk); if (id === undefined) ids.set(kk, (id = ids.size));
        key[o] = id;
      }
    }
    return { D, res, key };
  }, [layers, legend, tick, K]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = R.current; if (!r) return;
    dispose(r.vox); r.vox.clear();
    if (!grid || !legend) { r.render(); return; }
    const { D, res, key } = grid;
    const dx = 1 / Math.max(1, D - 1), dz = K > 1 ? H / (K - 1) : 0.05;
    const P = (i: number, j: number, k: number) => [i * dx - 0.5, j * dx - 0.5, zOf(k)];
    const solid: number[] = [], cloud: number[] = [];
    const shell = (i: number, j: number, k: number) => {
      const o = (k * D + j) * D + i, me = key[o];
      const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (const [a, b, c] of nb) {
        const ii = i + a, jj = j + b, kk = k + c;
        if (ii < 0 || jj < 0 || kk < 0 || ii >= D || jj >= D || kk >= K) continue;
        const v = key[(kk * D + jj) * D + ii];
        if (v >= 0 && v !== me) return true;
      }
      return false;
    };
    const hl = legend.entries.length && res.some((x) => x && !legend.isOn(x));
    // the largest class usually wraps everything else; leave it out of the shells
    const bg = hideBg ? legend.entries.find((e) => e.key !== 'forbidden' && e.key !== 'outgoing')?.key : undefined;
    for (let k = 0; k < K; k++) for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
      const o = (k * D + j) * D + i, pr = res[o];
      if (!pr || pr.kind !== 'traj') continue;
      if (hl) (legend.isOn(pr) ? solid : cloud).push(o);
      else if (mode === 'shell') { if (legend.keyOf(pr) !== bg && shell(i, j, k)) solid.push(o); }
      else cloud.push(o);
    }
    const col = new THREE.Color();
    if (solid.length) {
      const geo = new THREE.BoxGeometry(dx * 0.98, dx * 0.98, dz * 0.98);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), solid.length);
      const m4 = new THREE.Matrix4();
      solid.forEach((o, q) => {
        const i = o % D, j = Math.floor(o / D) % D, k = Math.floor(o / (D * D));
        const [x, y, z] = P(i, j, k);
        m4.makeTranslation(x, y, z); mesh.setMatrixAt(q, m4);
        const c = legend.colorOf(res[o]!); col.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); mesh.setColorAt(q, col);
      });
      mesh.userData.ids = solid;
      r.vox.add(mesh);
    }
    if (cloud.length) {
      const pos = new Float32Array(cloud.length * 3), cc = new Float32Array(cloud.length * 3);
      cloud.forEach((o, q) => {
        const i = o % D, j = Math.floor(o / D) % D, k = Math.floor(o / (D * D));
        pos.set(P(i, j, k), 3 * q);
        const c = hl ? [190, 194, 202] : legend.colorOf(res[o]!);
        col.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
        cc[3 * q] = col.r; cc[3 * q + 1] = col.g; cc[3 * q + 2] = col.b;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: hl ? 2 : 4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: hl ? 0.35 : 0.9, depthWrite: !hl }));
      pts.userData.ids = cloud;
      r.vox.add(pts);
    }
    if (mark) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 8), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
      sp.position.set((mark.u - win.p1a) / (win.p1b - win.p1a) - 0.5, (mark.v - win.p2a) / (win.p2b - win.p2a) - 0.5, zOf(mark.k));
      r.vox.add(sp);
    }
    r.render();
  }, [grid, mode, mark, hideBg]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the selected layer as a textured plane
  useEffect(() => {
    const r = R.current; if (!r) return;
    dispose(r.plane); r.plane.clear();
    const s = layers[layer];
    if (plane && s && legend) {
      const n = s.n1, img = new Uint8Array(n * n * 4);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const q = displayIndex(s, i, j), pr = q >= 0 ? s.res.get(q) : undefined;
        const c = pr ? legend.colorOf(pr) : [235, 235, 235], o = (j * n + i) * 4;
        img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
      }
      const tex = new THREE.DataTexture(img, n, n, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false }));
      m.position.z = zOf(layer);
      m.renderOrder = 3;
      r.plane.add(m);
      const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x0f172a }));
      fr.position.z = zOf(layer);
      r.plane.add(fr);
    }
    r.render();
  }, [layers, layer, plane, legend, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- click a voxel (drag = rotate)
  const down = useRef<{ x: number; y: number } | null>(null);
  const click = (e: React.PointerEvent) => {
    const r = R.current, d = down.current; down.current = null;
    if (!r || !d || !grid || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const rect = r.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.012 };
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), r.cam);
    const hits = ray.intersectObjects([...r.vox.children, ...r.plane.children.filter((c) => c instanceof THREE.Mesh)], false);
    const h = hits[0];
    if (!h) return;
    const { D } = grid;
    let i: number, j: number, k: number;
    if (h.object.userData.ids) {
      const o = (h.object.userData.ids as number[])[h.instanceId ?? h.index ?? 0];
      i = o % D; j = Math.floor(o / D) % D; k = Math.floor(o / (D * D));
      const u = win.p1a + (i / (D - 1)) * (win.p1b - win.p1a), v = win.p2a + (j / (D - 1)) * (win.p2b - win.p2a);
      onMark({ u, v, w: vals[k], k });
      setLayer(k);
    } else {
      // on the slice plane: exact position
      const u = win.p1a + (h.point.x + 0.5) * (win.p1b - win.p1a), v = win.p2a + (h.point.y + 0.5) * (win.p2b - win.p2a);
      onMark({ u, v, w: vals[layer], k: layer });
    }
    setInfo('');
  };

  const done = layers.filter(Boolean).length;
  return (
    <div className="vol-wrap">
      <div ref={wrap} className="three-canvas" onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={click} />
      {err && <div className="empty">{err}</div>}
      <div className="three-ctl">
        <div className="seg">
          <button className={mode === 'shell' ? 'on' : ''} onClick={() => setMode('shell')} title="voxels where the class changes">Boundaries</button>
          <button className={mode === 'cloud' ? 'on' : ''} onClick={() => setMode('cloud')} title="every voxel as a point">Cloud</button>
        </div>
        {mode === 'shell' && <label className="switch small"><input type="checkbox" checked={hideBg} onChange={(e) => setHideBg(e.target.checked)} /> hide the largest class</label>}
        <label className="switch small"><input type="checkbox" checked={plane} onChange={(e) => setPlane(e.target.checked)} /> layer plane</label>
        <div className="seg">
          {([['3D', [1.25, -1.75, 1.2]], ['top', [0, -0.001, 2.6]], [labels.u + '–' + labels.w, [0, -2.6, 0]], [labels.v + '–' + labels.w, [2.6, 0, 0]]] as [string, number[]][]).map(([t, p]) => (
            <button key={t} onClick={() => { const r = R.current; if (!r) return; r.cam.position.set(p[0], p[1], p[2]); r.ctl.target.set(0, 0, 0); r.ctl.update(); r.render(); }}>{t}</button>
          ))}
        </div>
      </div>
      <div className="three-note small dim">
        {done < K ? `${done} of ${K} layers computed · ` : ''}
        Box: {labels.u} (right) × {labels.v} (back) × {labels.w} (up). Boundaries = voxels whose class differs from a neighbour; click a legend entry to see that class as a solid. Click a voxel or the layer plane to mark a point. {info}
      </div>
    </div>
  );
}
