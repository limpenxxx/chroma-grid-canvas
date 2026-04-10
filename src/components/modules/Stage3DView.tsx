import { useRef, useMemo, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  useStage3DStore, type Fixture3D, type TrussElement, type RoomDimensions,
  type StageProp, type Fixture3DType, type StagePropType,
} from '@/store/stage3dStore';
import { useFixtureStore } from '@/store/fixtureStore';
import { useWledStore } from '@/store/wledStore';
import { useHueStore } from '@/store/hueStore';
import { useMagicHomeStore } from '@/store/magicHomeStore';
import { useLiveDmxLevels } from '@/hooks/useLiveDmxLevels';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Plus, Trash2, Box, CircleDot, StretchHorizontal, Lightbulb, ChevronDown, ChevronRight,
  Eye, EyeOff, Layers, Settings2,
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════
// Helper: resolve live color for a 3D fixture from system state
// ══════════════════════════════════════════════════════════════

function useLiveFixtureColor(fixture: Fixture3D): { r: number; g: number; b: number; dimmer: number; pan: number; tilt: number } {
  const dmxLevels = useLiveDmxLevels();
  const fixtureStore = useFixtureStore();
  const wledStore = useWledStore();
  const hueStore = useHueStore();
  const magicStore = useMagicHomeStore();

  return useMemo(() => {
    const def = { r: 0, g: 0, b: 0, dimmer: 255, pan: 128, tilt: 128 };

    // DMX fixture
    if (fixture.fixtureInstanceId) {
      const inst = fixtureStore.instances.find(i => i.id === fixture.fixtureInstanceId);
      if (!inst) return def;
      const fixDef = fixtureStore.definitions.find(d => d.id === inst.definitionId);
      if (!fixDef) return def;
      const mode = fixDef.modes.find(m => m.id === inst.modeId);
      if (!mode) return def;
      const result = { ...def };
      mode.channels.forEach(ch => {
        const addr = inst.dmxAddress + ch.number - 1;
        const val = dmxLevels[`${inst.universe}:${addr}`] ?? ch.defaultValue;
        switch (ch.function) {
          case 'red': result.r = val; break;
          case 'green': result.g = val; break;
          case 'blue': result.b = val; break;
          case 'dimmer': result.dimmer = val; break;
          case 'pan': result.pan = val; break;
          case 'tilt': result.tilt = val; break;
        }
      });
      return result;
    }

    // WLED device
    if (fixture.wledDeviceId) {
      const dev = wledStore.devices.find(d => d.id === fixture.wledDeviceId);
      if (dev?.state?.seg?.[0]?.col?.[0]) {
        const [r, g, b] = dev.state.seg[0].col[0];
        const dimmer = dev.state.bri ?? 255;
        return { r, g, b, dimmer, pan: 128, tilt: 128 };
      }
      return def;
    }

    // Hue light
    if (fixture.hueBridgeId && fixture.hueLightId) {
      const lights = hueStore.lights[fixture.hueBridgeId];
      const light = lights?.find(l => l.id === fixture.hueLightId);
      if (light?.state?.on) {
        const bri = light.state.bri ?? 254;
        // Hue lights use xy color — approximate with warm white
        return { r: 255, g: 200, b: 120, dimmer: Math.round(bri * 255 / 254), pan: 128, tilt: 128 };
      }
      return { ...def, dimmer: 0 };
    }

    // MagicHome
    if (fixture.magicDeviceId) {
      const dev = magicStore.devices.find(d => d.id === fixture.magicDeviceId);
      if (dev?.state && dev.online) {
        return {
          r: dev.state.color?.r ?? 0,
          g: dev.state.color?.g ?? 0,
          b: dev.state.color?.b ?? 0,
          dimmer: dev.state.on ? 255 : 0,
          pan: 128, tilt: 128,
        };
      }
      return { ...def, dimmer: 0 };
    }

    return def;
  }, [fixture, dmxLevels, fixtureStore, wledStore, hueStore, magicStore]);
}

// ══════════════════════════════════════════════════════════════
// 3D Components — all using simple wireframe/flat geometry
// ══════════════════════════════════════════════════════════════

function CheckeredFloorMaterial({ color1, color2, width, depth }: { color1: string; color2: string; width: number; depth: number }) {
  const texture = useMemo(() => {
    const size = 256;
    const tiles = 16; // tiles per texture
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const tileSize = size / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? color1 : color2;
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // Scale so each tile ≈ 1m
    tex.repeat.set(width / tiles, depth / tiles);
    tex.needsUpdate = true;
    return tex;
  }, [color1, color2, width, depth]);

  return <meshStandardMaterial map={texture} roughness={0.7} />;
}

function Room({ room }: { room: RoomDimensions }) {
  const { width, depth, height } = room;
  return (
    <group>
      {room.showFloor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[width, depth]} />
          {room.floorPattern === 'checkered' ? (
            <CheckeredFloorMaterial color1={room.floorColor} color2={room.floorColor2 || '#a8906e'} width={width} depth={depth} />
          ) : (
            <meshStandardMaterial color={room.floorColor} roughness={0.8} />
          )}
        </mesh>
      )}
      {room.showWalls && (
        <>
          {/* Back wall */}
          <mesh position={[0, height / 2, -depth / 2]}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* Left wall */}
          <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[depth, height]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.5} />
          </mesh>
          {/* Right wall */}
          <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[depth, height]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.5} />
          </mesh>
          {/* Front wall (behind camera, semi-transparent) */}
          <mesh position={[0, height / 2, depth / 2]}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.15} />
          </mesh>
        </>
      )}
      {room.showCeiling && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]}>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial color={room.ceilingColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}

function Truss3D({ truss }: { truss: TrussElement }) {
  return (
    <group position={[truss.x, truss.y, truss.z]} rotation={[0, (truss.rotY * Math.PI) / 180, 0]}>
      <mesh>
        <cylinderGeometry args={[0.025, 0.025, truss.length, 6]} />
        <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, truss.length, 6]} />
        <meshStandardMaterial color="#444444" metalness={0.8} roughness={0.3} />
      </mesh>
      {Array.from({ length: Math.floor(truss.length / 0.5) }).map((_, i) => (
        <mesh key={i} position={[0, 0, -truss.length / 2 + 0.25 + i * 0.5]} rotation={[Math.PI / 4, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.15, 4]} />
          <meshStandardMaterial color="#333333" metalness={0.6} />
        </mesh>
      ))}
      <Text position={[0, 0.15, 0]} fontSize={0.1} color="#666666" anchorX="center" anchorY="bottom">
        {truss.name}
      </Text>
    </group>
  );
}

// Stage props: cubes, pipes, platforms, risers, screens — simple flat-shaded geometry
function StageProp3D({ prop }: { prop: StageProp }) {
  const geometry = useMemo(() => {
    switch (prop.type) {
      case 'pipe':
        return <cylinderGeometry args={[prop.width / 2, prop.width / 2, prop.height, 8]} />;
      case 'platform':
      case 'riser':
      case 'cube':
      case 'wall-panel':
      case 'screen':
      default:
        return <boxGeometry args={[prop.width, prop.height, prop.depth]} />;
    }
  }, [prop.type, prop.width, prop.height, prop.depth]);

  if (!prop.visible) return null;

  return (
    <group
      position={[prop.x, prop.y, prop.z]}
      rotation={[(prop.rotX * Math.PI) / 180, (prop.rotY * Math.PI) / 180, (prop.rotZ * Math.PI) / 180]}
    >
      <mesh>
        {geometry}
        <meshStandardMaterial
          color={prop.color}
          transparent={prop.opacity < 1}
          opacity={prop.opacity}
          roughness={0.8}
          flatShading
        />
      </mesh>
      {/* Wireframe overlay for visibility */}
      <mesh>
        {geometry}
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.05} />
      </mesh>
      <Text position={[0, prop.height / 2 + 0.1, 0]} fontSize={0.08} color="#888888" anchorX="center" anchorY="bottom">
        {prop.name}
      </Text>
    </group>
  );
}

// ── Light Beam ──
function LightBeam({ color, angle, length, dimmer }: {
  color: THREE.Color; angle: number; length: number; dimmer: number;
}) {
  const radiusBottom = Math.tan((angle * Math.PI) / 360) * length;
  const opacity = Math.max(0.02, (dimmer / 255) * 0.2);

  return (
    <mesh position={[0, -length / 2, 0]}>
      <coneGeometry args={[radiusBottom, length, 12, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── WLED Strip visualization — individual LED dots ──
function WledStripVis({ length, orientation, liveColor, dimmer }: {
  length: number; orientation: 'horizontal' | 'vertical'; liveColor: THREE.Color; dimmer: number;
}) {
  const pixelCount = Math.min(Math.round(length * 30), 120); // ~30 LED/m, cap at 120 for perf
  const opacity = dimmer / 255;
  const isVert = orientation === 'vertical';

  return (
    <group>
      {/* Base bar */}
      <mesh>
        <boxGeometry args={isVert ? [0.02, length, 0.02] : [length, 0.02, 0.02]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      {/* LED dots — instanced for performance */}
      {Array.from({ length: pixelCount }).map((_, i) => {
        const t = (i / (pixelCount - 1)) - 0.5;
        const pos: [number, number, number] = isVert ? [0, t * length, 0.015] : [t * length, 0, 0.015];
        return (
          <mesh key={i} position={pos}>
            <circleGeometry args={[0.008, 6]} />
            <meshBasicMaterial color={liveColor} transparent opacity={opacity} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── WLED Matrix visualization ──
function WledMatrixVis({ w, h, orientation, liveColor, dimmer }: {
  w: number; h: number; orientation: 'horizontal' | 'vertical'; liveColor: THREE.Color; dimmer: number;
}) {
  const pixelW = Math.min(w, 32);
  const pixelH = Math.min(h, 32);
  const pxSize = 0.02;
  const totalW = pixelW * pxSize;
  const totalH = pixelH * pxSize;
  const opacity = dimmer / 255;
  const isVert = orientation === 'vertical';

  return (
    <group rotation={isVert ? [0, 0, 0] : [Math.PI / 2, 0, 0]}>
      {/* Backing */}
      <mesh position={[0, 0, -0.005]}>
        <boxGeometry args={[totalW + 0.01, totalH + 0.01, 0.005]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      {/* Pixels — simplified grid */}
      {Array.from({ length: pixelH }).map((_, row) => (
        <group key={row}>
          {Array.from({ length: pixelW }).map((_, col) => (
            <mesh key={col} position={[
              (col - (pixelW - 1) / 2) * pxSize,
              ((pixelH - 1) / 2 - row) * pxSize,
              0.001,
            ]}>
              <planeGeometry args={[pxSize * 0.85, pxSize * 0.85]} />
              <meshBasicMaterial color={liveColor} transparent opacity={opacity} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ── Fixture 3D Models — all types ──
function FixtureModel({ fixture, showBeams }: { fixture: Fixture3D; showBeams: boolean }) {
  const live = useLiveFixtureColor(fixture);
  const liveColor = useMemo(() => new THREE.Color(live.r / 255, live.g / 255, live.b / 255), [live.r, live.g, live.b]);
  const liveHex = useMemo(() => liveColor.getHexString(), [liveColor]);
  const dimFactor = live.dimmer / 255;

  // Pan/tilt for moving heads
  const panRad = ((live.pan - 128) / 128) * Math.PI; // ±180°
  const tiltRad = ((live.tilt - 128) / 128) * (Math.PI / 2); // ±90°

  const fixtureBody = useMemo(() => {
    switch (fixture.type) {
      case 'moving-head':
        return (
          <group>
            <mesh position={[0, 0.05, 0]}>
              <boxGeometry args={[0.2, 0.1, 0.15]} />
              <meshStandardMaterial color="#222222" metalness={0.7} roughness={0.3} flatShading />
            </mesh>
            <mesh position={[0, 0.15, 0]}>
              <boxGeometry args={[0.03, 0.15, 0.12]} />
              <meshStandardMaterial color="#333333" metalness={0.6} flatShading />
            </mesh>
            {/* Head — rotates with pan/tilt */}
            <group position={[0, 0.2, 0]} rotation={[tiltRad, panRad, 0]}>
              <mesh>
                <cylinderGeometry args={[0.07, 0.07, 0.12, 8]} />
                <meshStandardMaterial color="#1a1a1a" metalness={0.5} flatShading />
              </mesh>
              <mesh position={[0, -0.07, 0]}>
                <circleGeometry args={[0.06, 12]} />
                <meshBasicMaterial color={`#${liveHex}`} transparent opacity={Math.max(0.2, dimFactor)} />
              </mesh>
              {showBeams && fixture.showBeam && dimFactor > 0.01 && (
                <LightBeam color={liveColor} angle={fixture.beamAngle} length={fixture.beamLength} dimmer={live.dimmer} />
              )}
            </group>
          </group>
        );

      case 'par': case 'wash':
        return (
          <group>
            <mesh>
              <cylinderGeometry args={[0.1, 0.08, 0.15, 8]} />
              <meshStandardMaterial color="#222222" metalness={0.6} flatShading />
            </mesh>
            <mesh position={[0, -0.08, 0]}>
              <circleGeometry args={[0.08, 12]} />
              <meshBasicMaterial color={`#${liveHex}`} transparent opacity={Math.max(0.2, dimFactor)} />
            </mesh>
            {showBeams && fixture.showBeam && dimFactor > 0.01 && (
              <group position={[0, -0.08, 0]}>
                <LightBeam color={liveColor} angle={fixture.beamAngle} length={fixture.beamLength} dimmer={live.dimmer} />
              </group>
            )}
          </group>
        );

      case 'spot': case 'beam':
        return (
          <group>
            <mesh>
              <cylinderGeometry args={[0.06, 0.12, 0.25, 8]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.6} flatShading />
            </mesh>
            <mesh position={[0, -0.13, 0]}>
              <circleGeometry args={[0.06, 12]} />
              <meshBasicMaterial color={`#${liveHex}`} transparent opacity={Math.max(0.2, dimFactor)} />
            </mesh>
            {showBeams && fixture.showBeam && dimFactor > 0.01 && (
              <group position={[0, -0.13, 0]}>
                <LightBeam color={liveColor} angle={fixture.beamAngle} length={fixture.beamLength} dimmer={live.dimmer} />
              </group>
            )}
          </group>
        );

      case 'laser':
        return (
          <group>
            <mesh>
              <boxGeometry args={[0.15, 0.08, 0.2]} />
              <meshStandardMaterial color="#111111" metalness={0.7} flatShading />
            </mesh>
            <mesh position={[0, 0, -0.11]}>
              <circleGeometry args={[0.02, 8]} />
              <meshBasicMaterial color={`#${liveHex}`} transparent opacity={Math.max(0.3, dimFactor)} />
            </mesh>
          </group>
        );

      case 'wled-strip':
        return (
          <WledStripVis
            length={fixture.stripLength || 2}
            orientation={fixture.stripOrientation || 'horizontal'}
            liveColor={liveColor}
            dimmer={live.dimmer}
          />
        );

      case 'wled-matrix':
        return (
          <WledMatrixVis
            w={fixture.matrixW || 16}
            h={fixture.matrixH || 16}
            orientation={fixture.matrixOrientation || 'vertical'}
            liveColor={liveColor}
            dimmer={live.dimmer}
          />
        );

      case 'hue-bulb': case 'magic-bulb':
        return (
          <group>
            <mesh>
              <sphereGeometry args={[0.04, 8, 8]} />
              <meshBasicMaterial color={`#${liveHex}`} transparent opacity={Math.max(0.15, dimFactor * 0.9)} />
            </mesh>
            {/* Glow */}
            {dimFactor > 0.05 && (
              <mesh>
                <sphereGeometry args={[0.08, 8, 8]} />
                <meshBasicMaterial color={`#${liveHex}`} transparent opacity={dimFactor * 0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
            )}
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.015, 0.02, 0.03, 6]} />
              <meshStandardMaterial color="#888888" metalness={0.8} flatShading />
            </mesh>
          </group>
        );

      default:
        return (
          <mesh>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color="#333333" flatShading />
          </mesh>
        );
    }
  }, [fixture.type, fixture.stripLength, fixture.stripOrientation, fixture.matrixW, fixture.matrixH,
      fixture.matrixOrientation, fixture.showBeam, fixture.beamAngle, fixture.beamLength,
      liveHex, dimFactor, showBeams, liveColor, live.dimmer, panRad, tiltRad]);

  return (
    <group
      position={[fixture.x, fixture.y, fixture.z]}
      rotation={[(fixture.rotX * Math.PI) / 180, (fixture.rotY * Math.PI) / 180, (fixture.rotZ * Math.PI) / 180]}
      scale={[fixture.scaleX, fixture.scaleY, fixture.scaleZ]}
    >
      {fixtureBody}
      <Text position={[0, 0.35, 0]} fontSize={0.08} color="#888888" anchorX="center" anchorY="bottom">
        {fixture.name}
      </Text>
    </group>
  );
}

// ── Main Scene ──
function Scene() {
  const { fixtures3d, room, trusses, props, showBeams } = useStage3DStore();

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight position={[0, room.height - 0.5, 0]} intensity={0.2} color="#334455" />

      <Room room={room} />

      {trusses.map(t => <Truss3D key={t.id} truss={t} />)}
      {props.map(p => <StageProp3D key={p.id} prop={p} />)}
      {fixtures3d.map(f => <FixtureModel key={f.id} fixture={f} showBeams={showBeams} />)}

      <Grid
        position={[0, 0.001, 0]}
        args={[room.width, room.depth]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#222233"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#333355"
        fadeDistance={30}
        infiniteGrid={false}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.9}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// Side Panel — Add & Edit Objects
// ══════════════════════════════════════════════════════════════

const FIXTURE_TYPE_OPTIONS: { value: Fixture3DType; label: string; icon: string }[] = [
  { value: 'moving-head', label: 'Moving Head', icon: '◎' },
  { value: 'par', label: 'PAR', icon: '●' },
  { value: 'wash', label: 'Wash', icon: '●' },
  { value: 'spot', label: 'Spot', icon: '◈' },
  { value: 'beam', label: 'Beam', icon: '◈' },
  { value: 'laser', label: 'Laser', icon: '⟐' },
  { value: 'wled-strip', label: 'WLED Strip', icon: '▬' },
  { value: 'wled-matrix', label: 'WLED Matrix', icon: '⊞' },
  { value: 'hue-bulb', label: 'Philips Hue', icon: '💡' },
  { value: 'magic-bulb', label: 'MagicHome', icon: '💡' },
  { value: 'generic', label: 'Generic', icon: '□' },
];

const PROP_TYPE_OPTIONS: { value: StagePropType; label: string }[] = [
  { value: 'cube', label: 'Cube' },
  { value: 'pipe', label: 'Pipe / Tube' },
  { value: 'platform', label: 'Platform' },
  { value: 'riser', label: 'Riser' },
  { value: 'wall-panel', label: 'Wall Panel' },
  { value: 'screen', label: 'Screen / Display' },
];

type PanelSection = 'fixtures' | 'props' | 'trusses' | 'room';

function SidePanel() {
  const store = useStage3DStore();
  const fixtureStore = useFixtureStore();
  const wledStore = useWledStore();
  const hueStore = useHueStore();
  const magicStore = useMagicHomeStore();
  const [openSections, setOpenSections] = useState<Set<PanelSection>>(new Set(['fixtures']));
  const [addingType, setAddingType] = useState<'fixture' | 'prop' | 'truss' | null>(null);

  const toggleSection = (s: PanelSection) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const addFixture = (type: Fixture3DType) => {
    const id = `3d-${type}-${Date.now()}`;
    const f: Fixture3D = {
      id, name: `${type}-${store.fixtures3d.length + 1}`, type,
      x: 0, y: type === 'wled-strip' || type === 'wled-matrix' ? 2 : 3.5, z: 0,
      rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
      beamAngle: type === 'par' || type === 'wash' ? 40 : 15,
      beamLength: 4, showBeam: true,
      ...(type === 'wled-strip' ? { stripLength: 2, stripOrientation: 'horizontal' as const, ledCount: 60 } : {}),
      ...(type === 'wled-matrix' ? { matrixW: 16, matrixH: 16, matrixOrientation: 'vertical' as const } : {}),
    };
    store.addFixture3D(f);
    store.setSelectedObjectId(id);
    setAddingType(null);
  };

  const addProp = (type: StagePropType) => {
    const id = `prop-${Date.now()}`;
    store.addProp({
      id, name: `${type}-${store.props.length + 1}`, type,
      x: 0, y: type === 'pipe' ? 3 : 0.25, z: 0,
      width: type === 'pipe' ? 0.1 : 2,
      height: type === 'pipe' ? 3 : 0.5,
      depth: type === 'pipe' ? 0.1 : 2,
      rotX: 0, rotY: 0, rotZ: 0,
      color: '#222222', opacity: 1, visible: true,
    });
    store.setSelectedObjectId(id);
    setAddingType(null);
  };

  const addTruss = () => {
    const id = `truss-${Date.now()}`;
    store.addTruss({
      id, name: `Truss-${store.trusses.length + 1}`,
      x: 0, y: 3.5, z: 0, length: 4, rotY: 0,
    });
    store.setSelectedObjectId(id);
    setAddingType(null);
  };

  // Find selected object for editing
  const sel = store.selectedObjectId;
  const selectedFixture = store.fixtures3d.find(f => f.id === sel);
  const selectedProp = store.props.find(p => p.id === sel);
  const selectedTruss = store.trusses.find(t => t.id === sel);

  const SectionHeader = ({ label, section, count }: { label: string; section: PanelSection; count: number }) => (
    <button onClick={() => toggleSection(section)}
      className="flex items-center gap-1 w-full px-2 py-1.5 text-[9px] uppercase tracking-wider font-bold text-muted-foreground hover:text-foreground border-b border-border/10">
      {openSections.has(section) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      {label} <span className="text-primary/60 ml-1">({count})</span>
    </button>
  );

  return (
    <div className="w-full sm:w-56 max-h-[40vh] sm:max-h-none border-t sm:border-t-0 sm:border-l border-border/20 bg-card/40 overflow-y-auto text-xs flex flex-col">
      {/* ── Add Buttons ── */}
      <div className="flex gap-1 p-2 border-b border-border/20">
        <button onClick={() => setAddingType(addingType === 'fixture' ? null : 'fixture')}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
          <Plus size={10} /> Fixture
        </button>
        <button onClick={() => setAddingType(addingType === 'prop' ? null : 'prop')}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] bg-muted/30 text-foreground border border-border/20 hover:bg-muted/50">
          <Box size={10} /> Prop
        </button>
        <button onClick={() => { addTruss(); }}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] bg-muted/30 text-foreground border border-border/20 hover:bg-muted/50">
          <StretchHorizontal size={10} />
        </button>
      </div>

      {/* ── Add Fixture Picker ── */}
      {addingType === 'fixture' && (
        <div className="p-2 border-b border-border/20 bg-primary/5 space-y-1">
          <div className="text-[8px] uppercase tracking-wider text-primary font-semibold">Add Fixture</div>
          <div className="grid grid-cols-2 gap-1">
            {FIXTURE_TYPE_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => addFixture(opt.value)}
                className="text-left px-2 py-1 rounded bg-muted/30 hover:bg-primary/20 text-[9px] border border-border/20 truncate">
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Add Prop Picker ── */}
      {addingType === 'prop' && (
        <div className="p-2 border-b border-border/20 bg-muted/10 space-y-1">
          <div className="text-[8px] uppercase tracking-wider text-foreground font-semibold">Add Stage Prop</div>
          <div className="grid grid-cols-2 gap-1">
            {PROP_TYPE_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => addProp(opt.value)}
                className="text-left px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 text-[9px] border border-border/20">
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Fixtures list ── */}
      <SectionHeader label="Fixtures" section="fixtures" count={store.fixtures3d.length} />
      {openSections.has('fixtures') && (
        <div className="space-y-0.5 p-1">
          {store.fixtures3d.map(f => (
            <button key={f.id} onClick={() => store.setSelectedObjectId(sel === f.id ? null : f.id)}
              className={`w-full text-left px-2 py-1 rounded text-[9px] flex items-center gap-1 truncate ${
                sel === f.id ? 'bg-primary/20 text-primary' : 'hover:bg-muted/30 text-foreground/80'
              }`}>
              <span>{FIXTURE_TYPE_OPTIONS.find(o => o.value === f.type)?.icon || '□'}</span>
              <span className="truncate flex-1">{f.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Props list ── */}
      <SectionHeader label="Props" section="props" count={store.props.length} />
      {openSections.has('props') && (
        <div className="space-y-0.5 p-1">
          {store.props.map(p => (
            <button key={p.id} onClick={() => store.setSelectedObjectId(sel === p.id ? null : p.id)}
              className={`w-full text-left px-2 py-1 rounded text-[9px] flex items-center gap-1 truncate ${
                sel === p.id ? 'bg-primary/20 text-primary' : 'hover:bg-muted/30 text-foreground/80'
              }`}>
              <Box size={10} />
              <span className="truncate flex-1">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Trusses list ── */}
      <SectionHeader label="Trusses" section="trusses" count={store.trusses.length} />
      {openSections.has('trusses') && (
        <div className="space-y-0.5 p-1">
          {store.trusses.map(t => (
            <button key={t.id} onClick={() => store.setSelectedObjectId(sel === t.id ? null : t.id)}
              className={`w-full text-left px-2 py-1 rounded text-[9px] flex items-center gap-1 truncate ${
                sel === t.id ? 'bg-primary/20 text-primary' : 'hover:bg-muted/30 text-foreground/80'
              }`}>
              <StretchHorizontal size={10} />
              <span className="truncate flex-1">{t.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Room settings ── */}
      <SectionHeader label="Room" section="room" count={0} />
      {openSections.has('room') && (
        <div className="p-2 space-y-2">
          {(['width', 'depth', 'height'] as const).map(dim => (
            <div key={dim} className="flex items-center gap-2">
              <label className="text-[8px] uppercase text-muted-foreground w-10">{dim}</label>
              <Input type="number" step={0.5} min={1} max={100} value={store.room[dim]}
                onChange={e => store.setRoom({ [dim]: Number(e.target.value) })}
                className="h-7 sm:h-5 text-[16px] sm:text-[10px] bg-muted/30 border-border/30 font-mono flex-1" />
              <span className="text-[8px] text-muted-foreground">m</span>
            </div>
          ))}
          {/* Visibility toggles */}
          <div className="flex gap-2 mt-1">
            {(['showFloor', 'showWalls', 'showCeiling'] as const).map(k => (
              <button key={k} onClick={() => store.setRoom({ [k]: !store.room[k] })}
                className={`text-[8px] px-1.5 py-0.5 rounded border ${
                  store.room[k] ? 'bg-primary/10 text-primary border-primary/20' : 'text-muted-foreground border-border/20'
                }`}>
                {k.replace('show', '')}
              </button>
            ))}
          </div>
          {/* Color pickers */}
          <div className="space-y-1 mt-2">
            <label className="text-[7px] uppercase text-muted-foreground tracking-wider">Colors</label>
            {([
              { key: 'wallColor', label: 'Walls' },
              { key: 'ceilingColor', label: 'Ceiling' },
              { key: 'floorColor', label: 'Floor 1' },
              { key: 'floorColor2', label: 'Floor 2' },
            ] as const).map(c => (
              <div key={c.key} className="flex items-center gap-2">
                <input type="color" value={store.room[c.key] || '#808080'}
                  onChange={e => store.setRoom({ [c.key]: e.target.value })}
                  className="w-5 h-5 rounded border-none cursor-pointer" />
                <span className="text-[8px] text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>
          {/* Floor pattern */}
          <div className="flex gap-1 mt-1">
            {(['solid', 'checkered'] as const).map(p => (
              <button key={p} onClick={() => store.setRoom({ floorPattern: p })}
                className={`text-[8px] px-1.5 py-0.5 rounded border flex-1 ${
                  (store.room.floorPattern || 'solid') === p ? 'bg-primary/10 text-primary border-primary/20' : 'text-muted-foreground border-border/20'
                }`}>{p === 'checkered' ? '▦ Checkered' : '▬ Solid'}</button>
            ))}
          </div>
        </div>
      )}

      {/* ══════ PROPERTIES EDITOR ══════ */}
      {selectedFixture && (
        <FixtureProps fixture={selectedFixture} store={store}
          fixtureStore={fixtureStore} wledStore={wledStore} hueStore={hueStore} magicStore={magicStore} />
      )}
      {selectedProp && <PropProps prop={selectedProp} store={store} />}
      {selectedTruss && <TrussProps truss={selectedTruss} store={store} />}
    </div>
  );
}

// ── Property editors ──

function FixtureProps({ fixture, store, fixtureStore, wledStore, hueStore, magicStore }: {
  fixture: Fixture3D; store: ReturnType<typeof useStage3DStore.getState>;
  fixtureStore: any; wledStore: any; hueStore: any; magicStore: any;
}) {
  const up = (u: Partial<Fixture3D>) => store.updateFixture3D(fixture.id, u);
  return (
    <div className="border-t border-primary/20 p-2 space-y-2 mt-auto bg-primary/5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-primary">Properties</span>
        <button onClick={() => { store.removeFixture3D(fixture.id); store.setSelectedObjectId(null); }}
          className="text-destructive hover:text-destructive/80"><Trash2 size={12} /></button>
      </div>
      <Input value={fixture.name} onChange={e => up({ name: e.target.value })}
        className="h-7 sm:h-5 text-[16px] sm:text-[10px] bg-muted/30 border-border/30" />

      {/* Link to system fixture */}
      <div>
        <label className="text-[8px] uppercase text-muted-foreground">Link to</label>
        {(fixture.type === 'moving-head' || fixture.type === 'par' || fixture.type === 'wash' ||
          fixture.type === 'spot' || fixture.type === 'beam' || fixture.type === 'laser' || fixture.type === 'generic') && (
          <select value={fixture.fixtureInstanceId || ''} onChange={e => up({ fixtureInstanceId: e.target.value || undefined })}
            className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
            <option value="">— None —</option>
            {fixtureStore.instances.map((inst: any) => (
              <option key={inst.id} value={inst.id}>{inst.name}</option>
            ))}
          </select>
        )}
        {(fixture.type === 'wled-strip' || fixture.type === 'wled-matrix') && (
          <select value={fixture.wledDeviceId || ''} onChange={e => up({ wledDeviceId: e.target.value || undefined })}
            className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
            <option value="">— None —</option>
            {wledStore.devices.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
            ))}
          </select>
        )}
        {fixture.type === 'hue-bulb' && (
          <>
            <select value={fixture.hueBridgeId || ''} onChange={e => up({ hueBridgeId: e.target.value || undefined })}
              className="w-full h-5 rounded bg-muted/30 border border-border/30 text-[9px] px-1 text-foreground mb-1">
              <option value="">— Bridge —</option>
              {hueStore.bridges.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name || b.ip}</option>
              ))}
            </select>
            {fixture.hueBridgeId && hueStore.lights[fixture.hueBridgeId] && (
              <select value={fixture.hueLightId || ''} onChange={e => up({ hueLightId: e.target.value || undefined })}
                className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
                <option value="">— Light —</option>
                {hueStore.lights[fixture.hueBridgeId].map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </>
        )}
        {fixture.type === 'magic-bulb' && (
          <select value={fixture.magicDeviceId || ''} onChange={e => up({ magicDeviceId: e.target.value || undefined })}
            className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
            <option value="">— None —</option>
            {magicStore.devices.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name} ({d.address})</option>
            ))}
          </select>
        )}
      </div>

      {/* Position */}
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map(axis => (
          <div key={axis}>
            <label className="text-[7px] uppercase text-muted-foreground">{axis}</label>
            <Input type="number" step={0.1} value={fixture[axis]}
              onChange={e => up({ [axis]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>
      {/* Rotation */}
      <div className="grid grid-cols-3 gap-1">
        {(['rotX', 'rotY', 'rotZ'] as const).map(axis => (
          <div key={axis}>
            <label className="text-[7px] uppercase text-muted-foreground">{axis.replace('rot', 'R')}</label>
            <Input type="number" step={5} value={fixture[axis]}
              onChange={e => up({ [axis]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>

      {/* Strip-specific */}
      {fixture.type === 'wled-strip' && (
        <div className="grid grid-cols-2 gap-1">
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Length (m)</label>
            <Input type="number" step={0.1} value={fixture.stripLength || 2}
              onChange={e => up({ stripLength: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Orient</label>
            <select value={fixture.stripOrientation || 'horizontal'}
              onChange={e => up({ stripOrientation: e.target.value as any })}
              className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
              <option value="horizontal">Horiz</option>
              <option value="vertical">Vert</option>
            </select>
          </div>
        </div>
      )}
      {/* Matrix-specific */}
      {fixture.type === 'wled-matrix' && (
        <div className="grid grid-cols-3 gap-1">
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">W</label>
            <Input type="number" value={fixture.matrixW || 16}
              onChange={e => up({ matrixW: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">H</label>
            <Input type="number" value={fixture.matrixH || 16}
              onChange={e => up({ matrixH: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
          <div>
            <label className="text-[7px] uppercase text-muted-foreground">Orient</label>
            <select value={fixture.matrixOrientation || 'vertical'}
              onChange={e => up({ matrixOrientation: e.target.value as any })}
              className="w-full h-7 sm:h-5 rounded bg-muted/30 border border-border/30 text-[16px] sm:text-[9px] px-1 text-foreground">
              <option value="vertical">Vert</option>
              <option value="horizontal">Horiz</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function PropProps({ prop, store }: { prop: StageProp; store: any }) {
  const up = (u: Partial<StageProp>) => store.updateProp(prop.id, u);
  return (
    <div className="border-t border-border/20 p-2 space-y-2 mt-auto bg-muted/5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-foreground">Prop Properties</span>
        <button onClick={() => { store.removeProp(prop.id); store.setSelectedObjectId(null); }}
          className="text-destructive hover:text-destructive/80"><Trash2 size={12} /></button>
      </div>
      <Input value={prop.name} onChange={e => up({ name: e.target.value })}
        className="h-7 sm:h-5 text-[16px] sm:text-[10px] bg-muted/30 border-border/30" />
      {/* Position */}
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map(axis => (
          <div key={axis}>
            <label className="text-[7px] uppercase text-muted-foreground">{axis}</label>
            <Input type="number" step={0.1} value={prop[axis]}
              onChange={e => up({ [axis]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>
      {/* Size */}
      <div className="grid grid-cols-3 gap-1">
        {(['width', 'height', 'depth'] as const).map(dim => (
          <div key={dim}>
            <label className="text-[7px] uppercase text-muted-foreground">{dim[0].toUpperCase()}</label>
            <Input type="number" step={0.1} min={0.01} value={prop[dim]}
              onChange={e => up({ [dim]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>
      {/* Rotation */}
      <div className="grid grid-cols-3 gap-1">
        {(['rotX', 'rotY', 'rotZ'] as const).map(axis => (
          <div key={axis}>
            <label className="text-[7px] uppercase text-muted-foreground">{axis.replace('rot', 'R')}</label>
            <Input type="number" step={5} value={prop[axis]}
              onChange={e => up({ [axis]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>
      {/* Color & opacity */}
      <div className="flex gap-2 items-center">
        <input type="color" value={prop.color} onChange={e => up({ color: e.target.value })}
          className="w-6 h-6 rounded border border-border/30 cursor-pointer" />
        <div className="flex-1">
          <label className="text-[7px] uppercase text-muted-foreground">Opacity</label>
          <Slider value={[prop.opacity]} min={0} max={1} step={0.05}
            onValueChange={([v]) => up({ opacity: v })} className="w-full" />
        </div>
        <button onClick={() => up({ visible: !prop.visible })} className="text-muted-foreground">
          {prop.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </div>
  );
}

function TrussProps({ truss, store }: { truss: TrussElement; store: any }) {
  const up = (u: Partial<TrussElement>) => store.updateTruss(truss.id, u);
  return (
    <div className="border-t border-border/20 p-2 space-y-2 mt-auto bg-muted/5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-foreground">Truss Properties</span>
        <button onClick={() => { store.removeTruss(truss.id); store.setSelectedObjectId(null); }}
          className="text-destructive hover:text-destructive/80"><Trash2 size={12} /></button>
      </div>
      <Input value={truss.name} onChange={e => up({ name: e.target.value })}
        className="h-7 sm:h-5 text-[16px] sm:text-[10px] bg-muted/30 border-border/30" />
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map(axis => (
          <div key={axis}>
            <label className="text-[7px] uppercase text-muted-foreground">{axis}</label>
            <Input type="number" step={0.1} value={truss[axis]}
              onChange={e => up({ [axis]: Number(e.target.value) })}
              className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Length</label>
          <Input type="number" step={0.5} min={0.5} value={truss.length}
            onChange={e => up({ length: Number(e.target.value) })}
            className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
        </div>
        <div>
          <label className="text-[7px] uppercase text-muted-foreground">Rot Y</label>
          <Input type="number" step={5} value={truss.rotY}
            onChange={e => up({ rotY: Number(e.target.value) })}
            className="h-7 sm:h-5 text-[16px] sm:text-[9px] bg-muted/30 border-border/30 font-mono" />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Exported Component
// ══════════════════════════════════════════════════════════════

export function Stage3DView() {
  const { cameraPreset, setCameraPreset, showBeams, setShowBeams, room } = useStage3DStore();

  const cameraPos: Record<string, [number, number, number]> = {
    front: [0, 2, room.depth / 2 + 4],
    top: [0, room.height + 6, 0.1],
    side: [room.width / 2 + 4, 2, 0],
    free: [4, 3, 6],
  };

  return (
    <div className="h-full flex flex-col sm:flex-row bg-[hsl(240_10%_4%)]">
      {/* 3D Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-[hsl(0_0%_5%)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-2">3D Stage</span>
          {(['front', 'top', 'side', 'free'] as const).map(preset => (
            <button key={preset} onClick={() => setCameraPreset(preset)}
              className={`px-2 py-1 rounded text-[9px] uppercase tracking-wider transition-all ${
                cameraPreset === preset
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              }`}>
              {preset}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => setShowBeams(!showBeams)}
            className={`px-2 py-1 rounded text-[9px] uppercase tracking-wider transition-all ${
              showBeams ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-muted-foreground border border-transparent'
            }`}>
            {showBeams ? '◉ Beams' : '○ Beams'}
          </button>
        </div>

        <div className="flex-1 relative">
          <Canvas
            camera={{
              position: cameraPos[cameraPreset] || cameraPos.front,
              fov: 50, near: 0.1, far: 100,
            }}
            gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
            style={{ background: '#08080e' }}
            dpr={[1, 1.5]} // Cap pixel ratio for performance
          >
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </Canvas>

          <div className="absolute bottom-2 left-2 text-[8px] text-muted-foreground/30 font-mono">
            {room.width}×{room.depth}×{room.height}m · Scroll to zoom · Drag to orbit
          </div>
        </div>
      </div>

      {/* Side Panel */}
      <SidePanel />
    </div>
  );
}
