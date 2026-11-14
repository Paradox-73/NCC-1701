import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Starship } from './Starship.jsx';
import { ViewscreenOverlay } from './ViewscreenOverlay.jsx';

// The main viewscreen. Props (all optional):
//   warp   0..9                            stars sit still-ish at impulse and stretch into warp lines as it rises
//   mode   'space' | 'orbit' | 'tactical'  open space, a planet turning below, or the ship from above with a contact
//   alert  'green' | 'yellow' | 'red'      tint over the screen
//   hit    boolean                         static + flicker + a camera shake while true (and a moment after)
//   contact { x, z }                       tactical only: where the sensor blip sits, ship-relative (default ahead-right)

const N = 1400;
const FAR = 220;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

function placeStar(s, i, z) {
  // radius grows with depth so stars cover the screen evenly instead of bunching in the middle;
  // the minimum keeps the centre clear so warp lines fan out from it
  const r = (0.04 + Math.sqrt(Math.random()) * 0.9) * (Math.abs(z) * 0.75 + 4);
  const a = Math.random() * Math.PI * 2;
  s[i * 3] = Math.cos(a) * r;
  s[i * 3 + 1] = Math.sin(a) * r;
  s[i * 3 + 2] = z;
}

// Stars fly toward the camera along -z. Each star is a point (its head) and a line segment behind it whose
// length grows with speed, so at impulse they read as dots and at warp as streaks.
function Starfield({ warp, mode }) {
  const stars = useMemo(() => {
    const s = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) placeStar(s, i, -Math.random() * FAR);
    return s;
  }, []);
  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    return g;
  }, []);
  const heads = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return g;
  }, []);
  const speed = useRef(1);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.1); // a hidden tab shouldn't teleport every star on return
    const w = clamp(warp, 0, 9);
    const target = mode === 'orbit' ? 0.6 : 1.5 + w * w * 9;
    speed.current += (target - speed.current) * (1 - Math.exp(-1.2 * dt)); // ease in and out of warp
    const v = speed.current;
    const len = Math.min(60, v * 0.12);
    const warpK = clamp((v - 4) / 300, 0, 1); // 0 at impulse, 1 at high warp: tails turn blue
    const lp = lines.attributes.position.array;
    const lc = lines.attributes.color.array;
    const hp = heads.attributes.position.array;
    const hc = heads.attributes.color.array;
    for (let i = 0; i < N; i++) {
      let z = (stars[i * 3 + 2] += v * dt);
      if (z > 1) {
        placeStar(stars, i, -FAR + Math.random() * 20);
        z = stars[i * 3 + 2];
      }
      const x = stars[i * 3];
      const y = stars[i * 3 + 1];
      const b = clamp(1 - -z / FAR, 0.05, 1); // nearer = brighter
      lp.set([x, y, z, x, y, z - len], i * 6);
      lc.set([b, b, b, b * 0.25 * (1 - warpK), b * 0.35, b * (0.25 + 0.5 * warpK)], i * 6);
      hp.set([x, y, z], i * 3);
      hc.set([b, b, b], i * 3);
    }
    lines.attributes.position.needsUpdate = true;
    lines.attributes.color.needsUpdate = true;
    heads.attributes.position.needsUpdate = true;
    heads.attributes.color.needsUpdate = true;
  });

  return (
    <>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points geometry={heads} frustumCulled={false}>
        <pointsMaterial vertexColors size={1.6} sizeAttenuation={false} depthWrite={false} />
      </points>
    </>
  );
}

// Procedural planet surface: latitude bands plus soft blobs, drawn once into a canvas texture.
function planetTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#c9d6e8');
  grad.addColorStop(0.12, '#3e6f8f');
  grad.addColorStop(0.5, '#2f5f4a');
  grad.addColorStop(0.88, '#3e6f8f');
  grad.addColorStop(1, '#c9d6e8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const x = rnd() * 512;
    const y = 30 + rnd() * 196;
    const r = 6 + rnd() * 34;
    g.fillStyle = rnd() < 0.55 ? 'rgba(138,110,70,0.35)' : 'rgba(30,70,110,0.35)';
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(rnd() * 512, 20 + rnd() * 216, 30 + rnd() * 90, 2 + rnd() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function Planet() {
  const ref = useRef();
  const map = useMemo(planetTexture, []);
  useEffect(() => () => map.dispose(), [map]);
  useFrame((_, dt) => {
    ref.current.rotation.y += Math.min(dt, 0.1) * 0.03;
  });
  return (
    <group position={[0, -40, -46]} rotation={[0.35, 0, 0.12]}>
      <mesh ref={ref}>
        <sphereGeometry args={[34, 64, 32]} />
        <meshStandardMaterial map={map} roughness={0.9} metalness={0} />
      </mesh>
      {/* thin atmosphere rim */}
      <mesh scale={1.035}>
        <sphereGeometry args={[34, 48, 24]} />
        <meshBasicMaterial color="#6cb6ff" transparent opacity={0.22} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <directionalLight position={[-40, 70, 60]} intensity={3} />
      <ambientLight intensity={0.25} />
    </group>
  );
}

// Tactical: range rings + bearing ticks under the ship, and a pulsing sensor contact.
function Tactical({ alert, contact }) {
  const ring = useRef();
  const blip = useRef();
  const cx = contact?.x ?? -7;
  const cz = contact?.z ?? 9;
  const rings = useMemo(() => [6, 12, 18].map((r) => new THREE.RingGeometry(r - 0.04, r + 0.04, 96)), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime % 1.6;
    ring.current.scale.setScalar(0.4 + t * 1.6);
    ring.current.material.opacity = Math.max(0, 0.8 - t * 0.5);
    blip.current.material.opacity = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 6);
  });
  const hostile = alert === 'red';
  return (
    <group>
      {rings.map((g, i) => (
        <mesh key={i} geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]}>
          <meshBasicMaterial color="#3d6a8f" transparent opacity={0.55} />
        </mesh>
      ))}
      <gridHelper args={[90, 45, '#1d3550', '#122336']} position={[0, -1.25, 0]} />
      <group position={[cx, -1.1, cz]}>
        <mesh ref={blip} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.45, 24]} />
          <meshBasicMaterial color={hostile ? '#ff5a4a' : '#ffd36a'} transparent />
        </mesh>
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 1.0, 40]} />
          <meshBasicMaterial color={hostile ? '#ff5a4a' : '#ffd36a'} transparent />
        </mesh>
      </group>
      <Starship spin={false} alert={alert} warp={1} />
    </group>
  );
}

// Puts the camera where each mode wants it, and shakes it while hit.
function Rig({ mode, hit }) {
  const { camera } = useThree();
  const shake = useRef(0);
  useEffect(() => {
    if (mode === 'tactical') {
      camera.position.set(0, 34, 0.001);
      camera.up.set(0, 0, 1); // fore (+z) points up on screen, port on the left
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, mode === 'orbit' ? -0.12 : 0, -1);
    }
    camera.userData.base = camera.position.clone();
  }, [mode, camera]);
  useFrame((_, dt) => {
    shake.current = hit ? 1 : Math.max(0, shake.current - dt * 3);
    const base = camera.userData.base;
    if (!base) return;
    const s = shake.current * (mode === 'tactical' ? 0.35 : 0.06);
    camera.position.set(base.x + (Math.random() - 0.5) * s, base.y + (Math.random() - 0.5) * s, base.z + (Math.random() - 0.5) * s);
  });
  return null;
}

export default function Viewscreen({ warp = 0, mode = 'space', alert = 'green', hit = false, contact, className, style }) {
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 14, background: '#020308', ...style }}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 400 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
        <color attach="background" args={['#020308']} />
        <Rig mode={mode} hit={hit} />
        {mode === 'tactical' ? <Tactical alert={alert} contact={contact} /> : <Starfield warp={warp} mode={mode} />}
        {mode === 'orbit' && <Planet />}
      </Canvas>
      <ViewscreenOverlay alert={alert} hit={hit} />
    </div>
  );
}
