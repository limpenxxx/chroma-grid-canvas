import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useStage3DStore, type Fixture3D, type TrussElement, type RoomDimensions } from '@/store/stage3dStore';

// ── Room Component ──
function Room({ room }: { room: RoomDimensions }) {
  const { width, depth, height } = room;
  return (
    <group>
      {/* Floor */}
      {room.showFloor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial color={room.floorColor} roughness={0.8} />
        </mesh>
      )}
      {/* Back wall */}
      {room.showWalls && (
        <mesh position={[0, height / 2, -depth / 2]}>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Left wall */}
      {room.showWalls && (
        <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[depth, height]} />
          <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.4} />
        </mesh>
      )}
      {/* Right wall */}
      {room.showWalls && (
        <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[depth, height]} />
          <meshStandardMaterial color={room.wallColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.4} />
        </mesh>
      )}
      {/* Ceiling */}
      {room.showCeiling && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]}>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial color={room.ceilingColor} roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.3} />
        </mesh>
      )}
    </group>
  );
}

// ── Truss Component ──
function Truss3D({ truss }: { truss: TrussElement }) {
  return (
    <group position={[truss.x, truss.y, truss.z]} rotation={[0, (truss.rotY * Math.PI) / 180, 0]}>
      {/* Main tube */}
      <mesh>
        <cylinderGeometry args={[0.025, 0.025, truss.length, 8]} />
        <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Rotate to horizontal */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, truss.length, 8]} />
        <meshStandardMaterial color="#444444" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Cross braces */}
      {Array.from({ length: Math.floor(truss.length / 0.5) }).map((_, i) => (
        <mesh key={i} position={[0, 0, -truss.length / 2 + 0.25 + i * 0.5]} rotation={[Math.PI / 4, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.15, 4]} />
          <meshStandardMaterial color="#333333" metalness={0.6} />
        </mesh>
      ))}
      {/* Label */}
      <Text position={[0, 0.15, 0]} fontSize={0.12} color="#666666" anchorX="center" anchorY="bottom">
        {truss.name}
      </Text>
    </group>
  );
}

// ── Light Beam ──
function LightBeam({ color, angle, length, position, rotX, rotY }: {
  color: string; angle: number; length: number;
  position: [number, number, number]; rotX: number; rotY: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const radiusBottom = Math.tan((angle * Math.PI) / 360) * length;

  useFrame((_, delta) => {
    if (meshRef.current) {
      // Gentle sway for visual life
      meshRef.current.rotation.x += Math.sin(Date.now() * 0.001) * delta * 0.01;
    }
  });

  return (
    <group position={position} rotation={[(rotX * Math.PI) / 180, (rotY * Math.PI) / 180, 0]}>
      <mesh ref={meshRef} position={[0, -length / 2, 0]}>
        <coneGeometry args={[radiusBottom, length, 16, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Light source glow */}
      <mesh>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ── Fixture 3D Models ──
function FixtureModel({ fixture, showBeams }: { fixture: Fixture3D; showBeams: boolean }) {
  const color = '#00e5ff'; // TODO: read from DMX state via engine

  const fixtureBody = useMemo(() => {
    switch (fixture.type) {
      case 'moving-head':
        return (
          <group>
            {/* Base */}
            <mesh position={[0, 0.05, 0]}>
              <boxGeometry args={[0.2, 0.1, 0.15]} />
              <meshStandardMaterial color="#222222" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Yoke */}
            <mesh position={[0, 0.15, 0]}>
              <boxGeometry args={[0.03, 0.15, 0.12]} />
              <meshStandardMaterial color="#333333" metalness={0.6} />
            </mesh>
            {/* Head */}
            <mesh position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.5} />
            </mesh>
            {/* Lens */}
            <mesh position={[0, 0.27, 0]} rotation={[0, 0, 0]}>
              <circleGeometry args={[0.06, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.8} />
            </mesh>
          </group>
        );
      case 'par':
      case 'wash':
        return (
          <group>
            <mesh>
              <cylinderGeometry args={[0.1, 0.08, 0.15, 12]} />
              <meshStandardMaterial color="#222222" metalness={0.6} />
            </mesh>
            <mesh position={[0, -0.08, 0]}>
              <circleGeometry args={[0.08, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
          </group>
        );
      case 'wled-strip':
        return (
          <mesh>
            <boxGeometry args={[fixture.stripLength || 2, 0.02, 0.02]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      case 'wled-matrix':
        return (
          <mesh>
            <boxGeometry args={[(fixture.matrixW || 16) * 0.02, (fixture.matrixH || 16) * 0.02, 0.01]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      case 'hue-bulb':
      case 'magic-bulb':
        return (
          <group>
            <mesh>
              <sphereGeometry args={[0.04, 12, 12]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} />
            </mesh>
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.015, 0.02, 0.03, 8]} />
              <meshStandardMaterial color="#888888" metalness={0.8} />
            </mesh>
          </group>
        );
      case 'spot':
        return (
          <group>
            <mesh>
              <cylinderGeometry args={[0.06, 0.12, 0.25, 12]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.6} />
            </mesh>
            <mesh position={[0, -0.13, 0]}>
              <circleGeometry args={[0.06, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
          </group>
        );
      default:
        return (
          <mesh>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial color="#333333" />
          </mesh>
        );
    }
  }, [fixture.type, fixture.stripLength, fixture.matrixW, fixture.matrixH, color]);

  return (
    <group
      position={[fixture.x, fixture.y, fixture.z]}
      rotation={[(fixture.rotX * Math.PI) / 180, (fixture.rotY * Math.PI) / 180, (fixture.rotZ * Math.PI) / 180]}
      scale={[fixture.scaleX, fixture.scaleY, fixture.scaleZ]}
    >
      {fixtureBody}
      {/* Label */}
      <Text position={[0, 0.35, 0]} fontSize={0.1} color="#888888" anchorX="center" anchorY="bottom">
        {fixture.name}
      </Text>
      {/* Beam */}
      {showBeams && fixture.showBeam && (
        <LightBeam
          color={color}
          angle={fixture.beamAngle}
          length={fixture.beamLength}
          position={[0, 0, 0]}
          rotX={fixture.rotX}
          rotY={0}
        />
      )}
    </group>
  );
}

// ── Main Scene ──
function Scene() {
  const { fixtures3d, room, trusses, showBeams } = useStage3DStore();

  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[0, room.height - 0.5, 0]} intensity={0.3} color="#334455" />

      <Room room={room} />

      {trusses.map(t => <Truss3D key={t.id} truss={t} />)}
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

// ── Exported Component ──
export function Stage3DView() {
  const { cameraPreset, setCameraPreset, showBeams, setShowBeams, room } = useStage3DStore();

  const cameraPos: Record<string, [number, number, number]> = {
    front: [0, 2, room.depth / 2 + 4],
    top: [0, room.height + 6, 0.1],
    side: [room.width / 2 + 4, 2, 0],
    free: [4, 3, 6],
  };

  return (
    <div className="h-full flex flex-col bg-[hsl(240_10%_4%)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-[hsl(0_0%_5%)]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-2">3D Stage</span>

        {(['front', 'top', 'side', 'free'] as const).map(preset => (
          <button
            key={preset}
            onClick={() => setCameraPreset(preset)}
            className={`px-2 py-1 rounded text-[9px] uppercase tracking-wider transition-all ${
              cameraPreset === preset
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            {preset}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={() => setShowBeams(!showBeams)}
          className={`px-2 py-1 rounded text-[9px] uppercase tracking-wider transition-all ${
            showBeams ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-muted-foreground border border-transparent'
          }`}
        >
          {showBeams ? '◉ Beams ON' : '○ Beams OFF'}
        </button>
      </div>

      {/* 3D Canvas */}
      <div className="flex-1 relative">
        <Canvas
          camera={{
            position: cameraPos[cameraPreset] || cameraPos.front,
            fov: 50,
            near: 0.1,
            far: 100,
          }}
          shadows
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#08080e' }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>

        {/* Overlay info */}
        <div className="absolute bottom-3 left-3 text-[9px] text-muted-foreground/40 font-mono">
          Room: {room.width}×{room.depth}×{room.height}m · Scroll to zoom · Drag to orbit
        </div>
      </div>
    </div>
  );
}
