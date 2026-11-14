import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { FLIGHT_MS, FLYBY_MS } from './rig.js';

// What lifts the ship scene without new assets: a studio environment for the hull to reflect, a nebula and a
// deep starfield behind it, bloom on everything brighter than white (bussards, deflector, windows, running
// lights), filmic tone mapping and a vignette. `rig` takes the camera: 'flyby' (the cold open), 'login' (the hero
// shot, the ship left of the console) or 'board' (the flight into the saucer's bridge dome). Without `rig` the
// caller's controls own the camera.

// ---- backdrop ------------------------------------------------------------------------------------------------
function nebulaTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#010207';
  g.fillRect(0, 0, W, H);
  let seed = 1701;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  const blob = (x, y, r, color, a) => {
    for (const dx of [-W, 0, W]) { // drawn three times so the seam of the sphere does not show
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grad.addColorStop(0, `rgba(${color},${a})`);
      grad.addColorStop(0.5, `rgba(${color},${a * 0.35})`);
      grad.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = grad;
      g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  };
  // a cool band across the sky with a warm knot, as on the original-series matte paintings
  const band = (t) => H * (0.42 + 0.14 * Math.sin(t * Math.PI * 2 + 0.6));
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    blob(t * W, band(t) + (rnd() - 0.5) * 220, 120 + rnd() * 320, rnd() < 0.6 ? '40,86,170' : rnd() < 0.5 ? '96,48,150' : '24,120,140', 0.09 + rnd() * 0.12);
  }
  blob(W * 0.72, H * 0.46, 260, '190,92,48', 0.12);
  blob(W * 0.74, H * 0.44, 110, '255,170,110', 0.1);
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 2600; i++) {
    const a = rnd() ** 3 * 0.9;
    g.fillStyle = `rgba(${rnd() < 0.15 ? '255,214,180' : rnd() < 0.3 ? '170,200,255' : '235,240,255'},${a})`;
    const s = rnd() < 0.04 ? 2 : 1;
    g.fillRect(rnd() * W, rnd() * H, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function Backdrop() {
  const map = useMemo(nebulaTexture, []);
  useEffect(() => () => map.dispose(), [map]);
  const ref = useRef();
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += Math.min(dt, 0.1) * 0.004; });
  return (
    <mesh ref={ref} rotation={[0.18, 2.2, 0]} renderOrder={-1}>
      <sphereGeometry args={[420, 48, 24]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

// ---- camera rig ------------------------------------------------------------------------------------------------
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// The bridge sits on the highest point of the saucer's centre line. Found from the hull geometry in the ship's own
// frame (fore +z, up +y), so it works for the downloaded model and the primitives ship alike.
function findDome(scene) {
  const hull = [];
  scene.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial && o.geometry?.attributes.position) hull.push(o); });
  if (!hull.length) return null;
  let root = hull[0];
  while (root.parent && root.parent !== scene) root = root.parent;
  scene.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let xMin = Infinity, xMax = -Infinity, zMax = -Infinity;
  const each = (fn) => {
    for (const o of hull) {
      m.multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 6000));
      for (let i = 0; i < p.count; i += step) fn(v.fromBufferAttribute(p, i).applyMatrix4(m));
    }
  };
  each((p) => { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; if (p.z > zMax) zMax = p.z; });
  const r = (xMax - xMin) / 2; // the saucer is the widest part of the ship
  const top = new THREE.Vector3(0, -Infinity, zMax - r);
  each((p) => { if (Math.abs(p.x) < r * 0.1 && p.z > zMax - r * 1.6 && p.y > top.y) top.set(0, p.y, p.z); });
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
  return { dome: root.localToWorld(top.clone()), forward, scale: r };
}

const LOGIN_POS = new THREE.Vector3(11.4, 3.7, 12.2);
const LOGIN_LOOK = new THREE.Vector3(0, 0.15, 0);
const FLY_FROM = new THREE.Vector3(0.8, 0.4, 150); // far ahead of the bow: the ship a speck, head-on
const FLY_C1 = new THREE.Vector3(2, 0.9, 64);
const FLY_C2 = new THREE.Vector3(19, 3, 30);
const SETTLE_MS = 1100;

const bezier = (out, p0, c1, c2, p3, u) => out.copy(p0).multiplyScalar((1 - u) ** 3)
  .addScaledVector(c1, 3 * (1 - u) ** 2 * u).addScaledVector(c2, 3 * (1 - u) * u * u).addScaledVector(p3, u ** 3);

// mode: 'wait' (before the cold open starts), 'flyby' (the ship glides in and holds), 'login' (holds the hero
// shot), 'board' (into the dome)
function Rig({ mode }) {
  const { camera, scene, size } = useThree();
  const move = useRef(null);
  const look = useRef(LOGIN_LOOK.clone());
  const offset = useRef({ x: 0, y: 0 });
  const wide = size.width / size.height > 1.15;
  // where the ship rests on screen: left of the console on wide screens, above it on phones
  const rest = () => (wide ? { x: size.width * 0.15, y: size.height * 0.02 } : { x: 0, y: size.height * 0.2 });
  const restFov = wide ? 32 : 50;

  useEffect(() => {
    const base = { t0: performance.now(), from: camera.position.clone(), fromLook: look.current.clone(), fov0: camera.fov, off0: { ...offset.current } };
    if (mode === 'wait') {
      camera.position.copy(FLY_FROM);
      look.current.set(0, 0, 0);
      offset.current = { x: 0, y: 0 };
      camera.fov = restFov;
      move.current = null;
    } else if (mode === 'flyby') {
      camera.position.copy(FLY_FROM);
      look.current.set(0, 0, 0);
      offset.current = { x: 0, y: 0 };
      camera.fov = restFov;
      move.current = { ...base, kind: 'flyby', ms: FLYBY_MS, from: FLY_FROM.clone(), fromLook: new THREE.Vector3(), fov0: restFov, off0: { x: 0, y: 0 } };
    } else if (mode === 'login') {
      move.current = { ...base, kind: 'settle', ms: SETTLE_MS };
    } else if (mode === 'board') {
      const found = findDome(scene);
      move.current = found ? { ...base, kind: 'board', ms: FLIGHT_MS, ...found } : null;
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame(() => {
    const m = move.current;
    const target = rest();
    if (!m) offset.current = mode === 'board' || mode === 'wait' ? offset.current : target;
    else {
      const t = Math.min(1, (performance.now() - m.t0) / m.ms);
      if (m.kind === 'flyby' || m.kind === 'settle') {
        const u = easeInOut(t); // the glide starts and ends gently, holding as the theme starts
        if (m.kind === 'flyby') bezier(camera.position, m.from, FLY_C1, FLY_C2, LOGIN_POS, u);
        else camera.position.copy(m.from).lerp(LOGIN_POS, u);
        look.current.copy(m.fromLook).lerp(LOGIN_LOOK, m.kind === 'flyby' ? smooth(0.1, 0.9, t) : u);
        camera.fov = m.fov0 + (restFov - m.fov0) * u;
        const k = m.kind === 'flyby' ? smooth(0.55, 1, t) : u;
        offset.current = { x: m.off0.x + (target.x - m.off0.x) * k, y: m.off0.y + (target.y - m.off0.y) * k };
        if (t >= 1) move.current = null;
      } else {
        const u = easeInOut(t);
        const k = m.scale; // saucer radius: sizes the approach to the model
        const p1 = tmp.a.copy(m.dome).addScaledVector(tmp.up, k * 1.25).addScaledVector(m.forward, -k * 1.15); // above and aft of the dome
        const p2 = tmp.b.copy(m.dome).addScaledVector(tmp.up, k * 0.05);
        const c1 = tmp.c.copy(m.from).lerp(p1, 0.55).addScaledVector(tmp.up, k * 0.6);
        bezier(camera.position, m.from, c1, p1, p2, u);
        look.current.copy(m.fromLook).lerp(m.dome.clone().addScaledVector(m.forward, k * 0.35), smooth(0, 0.75, t));
        camera.fov = m.fov0 - 6 * smooth(0, 0.7, t) + 40 * smooth(0.82, 1, t); // narrows on approach, then the dive
        const s = 1 - smooth(0, 0.45, t);
        offset.current = { x: m.off0.x * s, y: m.off0.y * s };
      }
    }
    camera.lookAt(look.current);
    const o = offset.current;
    if (o.x || o.y) camera.setViewOffset(size.width, size.height, o.x, o.y, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  });
  return null;
}

// ---- the effects ---------------------------------------------------------------------------------------------
export default function SceneFX({ rig }) {
  return (
    <>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#e6eeff" position={[8, 9, 7]} scale={[12, 7, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.1} color="#ffab7a" position={[-12, -3, -7]} scale={[10, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1.6} color="#7fb4ff" position={[0, 5, -14]} scale={7} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.5} color="#9fb4d6" position={[0, -10, 0]} scale={[20, 20, 1]} target={[0, 0, 0]} />
      </Environment>
      <Backdrop />
      <Stars radius={150} depth={90} count={4000} factor={2.4} saturation={0.35} fade speed={0.15} />
      {rig && <Rig mode={rig} />}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.18} intensity={1.15} radius={0.72} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.62} />
      </EffectComposer>
    </>
  );
}
