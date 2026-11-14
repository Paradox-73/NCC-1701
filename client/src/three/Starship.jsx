import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

// Low-poly Constitution-class style ship, built only from three.js primitives (no downloaded models, no
// textures or markings from the show). The ship points down +z, y is up, port is +x.
//
// Props (all optional, all safe to update every frame):
//   warp     0..9                                    nacelle + deflector glow and pulse speed
//   shields  { fore, aft, port, starboard } 0..100   faint bubble per quadrant, flashes where a value drops
//   damage   { saucer, engineering, portNacelle, starboardNacelle } 0..1   tints that section toward red
//   alert    'green' | 'yellow' | 'red'              lighting mood
//   spin     idle rotation on/off (default on)

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

function Shields({ shields }) {
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
      const f = (flash.current[key] ?? 0) * Math.exp(-3.2 * dt);
      flash.current[key] = f < 0.002 ? 0 : f;
      const m = mats[i];
      m.color.copy(SHIELD).lerp(SHIELD_LOW, v < 30 ? 1 - v / 30 : 0);
      m.opacity = (v / 100) * 0.018 + f * 0.45;
    });
  });
  return (
    <group position={[0, 0.55, 0]} scale={[3.7, 2.3, 5.6]}>
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

export function Starship({ warp = 0, shields, damage, alert = 'green', spin = true }) {
  const root = useRef();
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

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (spin && root.current) root.current.rotation.y += dt * 0.12;
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
    <>
      {/* lights stay put while the ship turns, so the shading moves across the hull */}
      <Lights alert={alert} />
      <group ref={root}>
        <group position={[0, -0.4, 0]}>
          <Saucer material={saucerMat} />
          <Engineering material={engMat} deflector={glow.deflector} />
          <Nacelle side={1} material={portMat} bussard={glow.bussard} grille={glow.grille} />
          <Nacelle side={-1} material={stbdMat} bussard={glow.bussard} grille={glow.grille} />
          <Shields shields={shields} />
        </group>
      </group>
    </>
  );
}

// Drop-in view: canvas, stars and orbit controls around the ship. Pixel ratio is capped so a big screen
// doesn't cost more GPU than the rest of the bridge.
export default function StarshipCanvas({ className, style, ...ship }) {
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [10, 5, 10], fov: 40 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
        <color attach="background" args={['#04060c']} />
        <Stars radius={80} depth={40} count={1500} factor={3} fade speed={0.4} />
        <Starship {...ship} />
        <OrbitControls enablePan={false} minDistance={6} maxDistance={28} />
      </Canvas>
    </div>
  );
}
