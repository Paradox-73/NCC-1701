import { Component, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { reducedMotion } from '../lib/chartTheme.js';
import SceneFX from './SceneFX.jsx';

// The ship: the TOS Enterprise model from client/public/models/enterprise.glb, with a low-poly ship built
// from three.js primitives as the fallback (if the model fails to load, or with model={null}).
// Both point down +z, y is up, port is +x.
//
// Props (all optional, all safe to update every frame):
//   warp     0..9                                    nacelle + deflector glow and pulse speed
//   shields  { fore, aft, port, starboard } 0..100   faint bubble per quadrant, flashes where a value drops
//   damage   { saucer, engineering, portNacelle, starboardNacelle } 0..1   tints that section toward red
//   alert    'green' | 'yellow' | 'red'              lighting mood
//   spin     idle rotation on/off (default on)
//   visible  false hides the ship and keeps the scene around it (default true)

const HULL = new THREE.Color('#c9ccd3');
const HURT = new THREE.Color('#b3261e');
const BUSSARD = new THREE.Color('#ff5a2a');
const WARP_BLUE = new THREE.Color('#5fb4ff');
const SHIELD = new THREE.Color('#6cc6ff');
const SHIELD_LOW = new THREE.Color('#ff6b5a');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// Lathe profiles are (radius, height) pairs spun around y.
const SAUCER_R = 2.35;
const SAUCER_PROFILE = [
  [0, 0.3], [0.3, 0.28], [0.72, 0.17], [0.97, 0.05], [1, 0], [0.97, -0.08], [0.72, -0.2], [0.33, -0.34], [0, -0.38],
].map(([r, y]) => new THREE.Vector2(r * SAUCER_R, y));

const ENGINEERING_PROFILE = [
  [0, 2.35], [0.5, 2.3], [0.72, 1.9], [0.8, 0.9], [0.78, -0.4], [0.62, -1.6], [0.4, -2.35], [0.26, -2.6], [0, -2.6],
].map(([r, y]) => new THREE.Vector2(r, y));

function useHullMaterial() {
  return useMemo(() => new THREE.MeshStandardMaterial({ color: HULL.clone(), roughness: 0.55, metalness: 0.25, flatShading: true }), []);
}

// A hull section's colour and a faint red flicker follow its damage value.
function tintSection(mat, dmg, t) {
  mat.color.copy(HULL).lerp(HURT, dmg * 0.85);
  mat.emissive.copy(HURT);
  mat.emissiveIntensity = dmg > 0.5 ? (dmg - 0.5) * 0.8 * (0.6 + 0.4 * Math.sin(t * 9)) : 0;
}

function Saucer({ material }) {
  const windows = useRef();
  const count = 36;
  const ringGeo = useMemo(() => new THREE.LatheGeometry(SAUCER_PROFILE, 40), []);
  // window lights around the rim, placed once when the instanced mesh mounts
  const placeWindows = (mesh) => {
    if (!mesh) return;
    windows.current = mesh;
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      m.makeRotationY(-a).setPosition(Math.cos(a) * SAUCER_R * 0.985, 0.0, Math.sin(a) * SAUCER_R * 0.985);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return (
    <group position={[0, 1.2, 2.7]}>
      <mesh geometry={ringGeo} material={material} />
      {/* bridge dome on top, sensor dome underneath */}
      <mesh position={[0, 0.28, 0]} material={material}>
        <sphereGeometry args={[0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 0.66, 0]} material={material}>
        <cylinderGeometry args={[0.1, 0.14, 0.1, 12]} />
      </mesh>
      <mesh position={[0, -0.36, 0]} rotation={[Math.PI, 0, 0]} material={material}>
        <sphereGeometry args={[0.24, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <instancedMesh ref={placeWindows} args={[undefined, undefined, count]}>
        <boxGeometry args={[0.03, 0.035, 0.09]} />
        <meshBasicMaterial color="#fff6d8" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Engineering({ material, deflector }) {
  const geo = useMemo(() => new THREE.LatheGeometry(ENGINEERING_PROFILE, 20), []);
  return (
    <group position={[0, -0.35, -0.9]}>
      <mesh geometry={geo} material={material} rotation={[Math.PI / 2, 0, 0]} />
      {/* neck up to the saucer */}
      <mesh position={[0, 0.98, 1.25]} rotation={[0.5, 0, 0]} material={material}>
        <boxGeometry args={[0.3, 1.0, 1.25]} />
      </mesh>
      {/* deflector dish at the front of the secondary hull */}
      <mesh position={[0, -0.05, 2.33]} scale={[1, 1, 0.45]} material={deflector}>
        <sphereGeometry args={[0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* shuttle bay block at the back */}
      <mesh position={[0, 0.28, -2.3]} material={material}>
        <boxGeometry args={[0.7, 0.5, 0.6]} />
      </mesh>
    </group>
  );
}

function Nacelle({ side, material, bussard, grille }) {
  const x = side * 1.55;
  return (
    <group>
      {/* pylon from the engineering hull up and out to the nacelle */}
      <mesh position={[side * 0.8, 0.55, -2.1]} rotation={[0.15, 0, -side * 0.68]} material={material}>
        <boxGeometry args={[0.12, 2.0, 0.55]} />
      </mesh>
      <group position={[x, 1.45, -2.4]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={material}>
          <cylinderGeometry args={[0.3, 0.3, 4.3, 14]} />
        </mesh>
        {/* rear end cap */}
        <mesh position={[0, 0, -2.2]} rotation={[-Math.PI / 2, 0, 0]} material={material}>
          <coneGeometry args={[0.3, 0.3, 14]} />
        </mesh>
        {/* glowing collector dome at the front */}
        <mesh position={[0, 0, 2.15]} material={bussard}>
          <sphereGeometry args={[0.31, 16, 10]} />
        </mesh>
        {/* warp grille along the inboard side */}
        <mesh position={[-side * 0.27, 0, -0.2]} material={grille}>
          <boxGeometry args={[0.07, 0.16, 3.4]} />
        </mesh>
      </group>
    </group>
  );
}

// Four partial spheres around the ship. Each sits at a faint level that follows its strength, and flashes
// when its value drops (a hit), then fades back.
const QUADRANTS = [
  // SphereGeometry phi: 0 = -x (starboard), pi/2 = +z (fore), pi = +x (port), 3pi/2 = -z (aft)
  { key: 'starboard', phiStart: -Math.PI / 4 },
  { key: 'fore', phiStart: Math.PI / 4 },
  { key: 'port', phiStart: (3 * Math.PI) / 4 },
  { key: 'aft', phiStart: (5 * Math.PI) / 4 },
];

function Shields({ shields, position = [0, 0.55, 0], scale = [3.7, 2.3, 5.6] }) {
  const mats = useMemo(
    () =>
      QUADRANTS.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: SHIELD.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
      ),
    [],
  );
  const last = useRef({});
  const flash = useRef({});
  useFrame((_, dt) => {
    QUADRANTS.forEach(({ key }, i) => {
      const v = clamp(shields?.[key] ?? 100, 0, 100);
      const prev = last.current[key] ?? v;
      if (v < prev - 0.5) flash.current[key] = Math.min(1, (flash.current[key] ?? 0) + 0.55 + (prev - v) / 25);
      last.current[key] = v;
      const f = (flash.current[key] ?? 0) * Math.exp(-1.6 * dt);
      flash.current[key] = f < 0.002 ? 0 : f;
      const m = mats[i];
      m.color.copy(SHIELD).lerp(SHIELD_LOW, v < 30 ? 1 - v / 30 : 0);
      m.opacity = (v / 100) * 0.018 + f * 0.45;
    });
  });
  return (
    <group position={position} scale={scale}>
      {QUADRANTS.map(({ key, phiStart }, i) => (
        <mesh key={key} material={mats[i]}>
          <sphereGeometry args={[1, 24, 16, phiStart, Math.PI / 2]} />
        </mesh>
      ))}
    </group>
  );
}

const MOODS = {
  green: { ambient: '#9fb4d6', ambientI: 0.55, key: '#ffffff', keyI: 2.2, red: 0 },
  yellow: { ambient: '#d9b36a', ambientI: 0.5, key: '#ffe6b0', keyI: 1.9, red: 0 },
  red: { ambient: '#a43a3a', ambientI: 0.35, key: '#ffd0c8', keyI: 1.3, red: 1 },
};

function Lights({ alert }) {
  const amb = useRef();
  const key = useRef();
  const redLight = useRef();
  useFrame(({ clock }, dt) => {
    const mood = MOODS[alert] ?? MOODS.green;
    const k = 1 - Math.exp(-4 * dt); // ease toward the new mood instead of snapping
    amb.current.color.lerp(new THREE.Color(mood.ambient), k);
    amb.current.intensity += (mood.ambientI - amb.current.intensity) * k;
    key.current.color.lerp(new THREE.Color(mood.key), k);
    key.current.intensity += (mood.keyI - key.current.intensity) * k;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
    redLight.current.intensity = mood.red * (6 + 10 * pulse);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.55} />
      <directionalLight ref={key} position={[6, 9, 7]} intensity={2.2} />
      <directionalLight position={[-6, -3, -8]} intensity={0.5} color="#6f8fbf" />
      <pointLight ref={redLight} position={[0, 5, 0]} distance={20} color="#ff2020" intensity={0} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// The downloaded TOS model (client/public/models/enterprise.glb, credited in CREDITS.md). Its meshes are
// unnamed and don't follow the hull sections, so damage is worked out per pixel from where that pixel sits
// on the ship (a small shader patch), and the warp glow is extra additive spheres on the bussard domes.
//
// Model units: fore is +z, up is +y, port is +x (same as the primitives ship), about 289 long.
export const MODEL_URL = `${import.meta.env.BASE_URL}models/enterprise.glb`;
// Fetch + decode the glb ahead of time (main.jsx calls this when the browser is idle), so the first 3D
// view doesn't stall on it.
export const preloadShip = () => useGLTF.preload(MODEL_URL, false, true);
const MODEL_LENGTH = 289;
const SHIP_LENGTH = 10.5; // same overall size as the primitives ship, so cameras and shields fit both
const BUSSARDS = [
  [42, 26.2, 8.5],
  [-42, 26.2, 8.5],
];

// Section split in model units: nacelles are the high, wide parts aft of the saucer, the saucer is the
// high part forward, everything else counts as engineering.
const SECTION_GLSL = /* glsl */ `
  float shipDamage;
  if (abs(vShipPos.x) > 30.0 && vShipPos.y > 12.0 && vShipPos.z < 20.0) shipDamage = vShipPos.x > 0.0 ? uDamage.z : uDamage.w;
  else if (vShipPos.z > 25.0 && vShipPos.y > -2.0) shipDamage = uDamage.x;
  else shipDamage = uDamage.y;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.16, 0.12), shipDamage * 0.75);
  totalEmissiveRadiance += vec3(0.75, 0.12, 0.06) * max(0.0, shipDamage - 0.5) * 1.6 * (0.6 + 0.4 * sin(uTime * 9.0));
`;

function patchDamage(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      'uniform mat4 uRootInv;\nvarying vec3 vShipPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vShipPos = (uRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader =
      'uniform vec4 uDamage;\nuniform float uTime;\nvarying vec3 vShipPos;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${SECTION_GLSL}`);
  };
  material.customProgramCacheKey = () => 'ncc-ship-damage';
}

function EnterpriseHull({ url, warp, damage }) {
  const gltf = useGLTF(url, false, true); // no draco, meshopt decoder on
  const frame = useRef();
  const { scene, uniforms, bussardMats } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    const uniforms = { uDamage: { value: new THREE.Vector4() }, uTime: { value: 0 }, uRootInv: { value: new THREE.Matrix4() } };
    const bussardMats = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      patchDamage(o.material, uniforms);
      if (/bussard/i.test(o.material.name)) bussardMats.push(o.material);
    });
    return { scene, uniforms, bussardMats };
  }, [gltf]);
  const glowMat = useMemo(() => {
    // soft round glow: a radial gradient on a sprite, so it has no hard edge from any angle
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,190,140,1)');
    grad.addColorStop(0.35, 'rgba(255,110,50,0.55)');
    grad.addColorStop(1, 'rgba(255,60,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  }, []);
  const glows = useRef([]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const w = clamp(warp, 0, 9) / 9;
    const pulse = 0.78 + 0.22 * Math.sin(t * (1.2 + w * 5));
    uniforms.uTime.value = t;
    uniforms.uDamage.value.set(
      clamp(damage?.saucer ?? 0, 0, 1),
      clamp(damage?.engineering ?? 0, 0, 1),
      clamp(damage?.portNacelle ?? 0, 0, 1),
      clamp(damage?.starboardNacelle ?? 0, 0, 1),
    );
    if (frame.current) uniforms.uRootInv.value.copy(frame.current.matrixWorld).invert();
    for (const m of bussardMats) m.emissiveIntensity = (0.7 + 2.2 * w) * pulse;
    glowMat.opacity = (0.15 + 0.85 * w) * pulse;
    for (const g of glows.current) g?.scale.setScalar(26 + 22 * w * pulse);
  });

  const s = SHIP_LENGTH / MODEL_LENGTH;
  return (
    <group ref={frame} scale={s}>
      <primitive object={scene} />
      {BUSSARDS.map((p, i) => (
        <sprite key={i} ref={(el) => (glows.current[i] = el)} position={p} material={glowMat} />
      ))}
    </group>
  );
}

// If the glb can't be fetched or decoded, show the primitives ship instead of an empty scene.
class ModelBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn('[starship] model failed to load, using the primitives ship', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ---------------------------------------------------------------------------------------------------
// The hand-built ship: fallback if the model fails to load, and the `model={null}` option.
function PrimitiveHull({ warp, damage, shields }) {
  const saucerMat = useHullMaterial();
  const engMat = useHullMaterial();
  const portMat = useHullMaterial();
  const stbdMat = useHullMaterial();
  const glow = useMemo(
    () => ({
      bussard: new THREE.MeshStandardMaterial({ color: '#331008', emissive: BUSSARD.clone(), toneMapped: false }),
      grille: new THREE.MeshStandardMaterial({ color: '#0a1830', emissive: WARP_BLUE.clone(), toneMapped: false }),
      deflector: new THREE.MeshStandardMaterial({ color: '#2a1a08', emissive: new THREE.Color('#ffae42'), toneMapped: false }),
    }),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const w = clamp(warp, 0, 9) / 9;
    const pulse = 0.78 + 0.22 * Math.sin(t * (1.2 + w * 5));
    glow.bussard.emissiveIntensity = (0.35 + 2.6 * w) * pulse;
    glow.grille.emissiveIntensity = (0.1 + 2.2 * w) * pulse;
    glow.deflector.emissiveIntensity = 0.5 + 1.2 * w;
    tintSection(saucerMat, clamp(damage?.saucer ?? 0, 0, 1), t);
    tintSection(engMat, clamp(damage?.engineering ?? 0, 0, 1), t);
    tintSection(portMat, clamp(damage?.portNacelle ?? 0, 0, 1), t);
    tintSection(stbdMat, clamp(damage?.starboardNacelle ?? 0, 0, 1), t);
  });

  return (
    <group position={[0, -0.4, 0]}>
      <Saucer material={saucerMat} />
      <Engineering material={engMat} deflector={glow.deflector} />
      <Nacelle side={1} material={portMat} bussard={glow.bussard} grille={glow.grille} />
      <Nacelle side={-1} material={stbdMat} bussard={glow.bussard} grille={glow.grille} />
      <Shields shields={shields} />
    </group>
  );
}

// model: URL of the glb (default the TOS Enterprise), or null for the primitives ship only.
// hold: a ref holding the performance.now() until which the idle turn waits (someone is steering the camera).
export function Starship({ warp = 0, shields, damage, alert = 'green', spin = true, visible = true, hold, model = MODEL_URL }) {
  const root = useRef();
  useFrame((_, dt) => {
    if (spin && root.current && !(hold?.current > performance.now())) root.current.rotation.y += Math.min(dt, 0.1) * 0.12;
  });
  const primitives = <PrimitiveHull warp={warp} damage={damage} shields={shields} />;
  return (
    <>
      {/* lights stay put while the ship turns, so the shading moves across the hull */}
      <Lights alert={alert} />
      <group ref={root} visible={visible}>
        {model ? (
          <ModelBoundary fallback={primitives}>
            <Suspense fallback={null}>
              <EnterpriseHull url={model} warp={warp} damage={damage} />
              <Shields shields={shields} position={[0, 0, 0.1]} scale={[3.0, 1.9, 6.3]} />
            </Suspense>
          </ModelBoundary>
        ) : (
          primitives
        )}
      </group>
    </>
  );
}

// Drop-in view: canvas, stars and orbit controls around the ship. Pixel ratio is capped so a big screen
// doesn't cost more GPU than the rest of the bridge.
// `rig` hands the camera to SceneFX's camera moves ('flyby', 'login', 'board') instead of the orbit controls.
// On 'login' the visitor can turn and zoom the ship; a hint says how until they first do.
export default function StarshipCanvas({ className, style, rig, spin = true, ...ship }) {
  const hold = useRef(0);
  const [steered, setSteered] = useState(false);
  const onSteer = useCallback(() => setSteered(true), []);
  const [still] = useState(reducedMotion);
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches);
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <Canvas dpr={[1, 1.5]} resize={{ offsetSize: true }} camera={{ position: [10, 5, 10], fov: 40 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
        <color attach="background" args={['#04060c']} />
        <Stars radius={80} depth={40} count={1500} factor={3} fade speed={0.4} />
        <Starship {...ship} spin={spin && !still} hold={hold} />
        <SceneFX rig={rig} hold={hold} onSteer={onSteer} />
        {!rig && <OrbitControls enablePan={false} minDistance={6} maxDistance={28} />}
      </Canvas>
      {rig === 'login' && (
        <p className="ship-hint" aria-hidden="true"><span data-gone={steered || undefined}>{touch ? 'Drag to rotate · pinch to zoom' : 'Drag to rotate · scroll to zoom'}</span></p>
      )}
    </div>
  );
}
