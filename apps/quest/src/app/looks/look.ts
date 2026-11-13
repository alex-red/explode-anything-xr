import { Color, DoubleSide, Group, Mesh, MeshPhysicalMaterial, type BufferGeometry, type Texture } from '@iwsdk/core';
import type { PartShape } from '@explode/contracts';
import { COLOR } from '../palette.ts';
import type { Assembly, Finish } from './kit.ts';

/** How a part is shown right now; the lesson state decides it (graph-view). */
export type LookState = 'rest' | 'hover' | 'selected' | 'path' | 'fault' | 'dim';

const PATH = new Color(COLOR.path);
const FAULT = new Color(COLOR.fault);
const SELECT_GLOW = new Color(0x2a3a4c);
const noRaycast = () => {};

interface Layer {
  mat: MeshPhysicalMaterial;
  base: Color;
  glow: Color;
  glowIntensity: number;
}

/**
 * A mechanical part drawn as the real thing: physically based materials (metal, plastic, glass,
 * rubber, foam), one merged mesh per finish. State is shown by tinting and glowing those
 * materials, never by swapping them. Its meshes take no ray hits: the part's plain hit volume
 * (its parent) is what rays aim at, so a shaft sticking out or a gap between spokes never changes
 * what a pinch lands on.
 */
export class PartLook {
  readonly group = new Group();
  private readonly layers: Layer[] = [];
  private state: LookState | null = null;

  constructor(assembly: Assembly, env: Texture | null) {
    this.group.name = 'look';
    for (const [finish, geometry] of assembly.merged()) {
      const mat = material(finish, env);
      const mesh = new Mesh<BufferGeometry, MeshPhysicalMaterial>(geometry, mat);
      mesh.name = finish.name;
      mesh.raycast = noRaycast;
      this.group.add(mesh);
      this.layers.push({ mat, base: mat.color.clone(), glow: mat.emissive.clone(), glowIntensity: mat.emissiveIntensity });
    }
  }

  /** Number of draw calls (one per finish). */
  get meshes(): number {
    return this.layers.length;
  }

  /** Apply a state; `pulse` (0..1) breathes the fault glow. No allocation. */
  set(state: LookState, pulse = 0): void {
    if (state === this.state && state !== 'fault') return;
    this.state = state;
    for (const l of this.layers) {
      const m = l.mat;
      m.color.copy(l.base);
      m.emissive.copy(l.glow);
      m.emissiveIntensity = l.glowIntensity;
      switch (state) {
        case 'fault':
          m.color.lerp(FAULT, 0.45);
          m.emissive.copy(FAULT);
          m.emissiveIntensity = 0.3 + 0.35 * pulse;
          break;
        case 'path':
          m.color.lerp(PATH, 0.35);
          m.emissive.copy(PATH);
          m.emissiveIntensity = 0.35;
          break;
        case 'dim':
          m.color.multiplyScalar(0.3);
          m.emissiveIntensity = l.glowIntensity * 0.2;
          break;
        case 'selected':
          if (l.glowIntensity === 0) {
            m.emissive.copy(SELECT_GLOW);
            m.emissiveIntensity = 1;
          }
          break;
        case 'hover':
        case 'rest':
          break;
      }
    }
  }

  dispose(): void {
    for (const child of this.group.children) (child as Mesh).geometry.dispose();
    for (const l of this.layers) l.mat.dispose();
  }
}

function material(f: Finish, env: Texture | null): MeshPhysicalMaterial {
  const see = f.opacity !== undefined && f.opacity < 1;
  const m = new MeshPhysicalMaterial({
    color: f.color,
    metalness: f.metalness,
    roughness: f.roughness,
    clearcoat: f.clearcoat ?? 0,
    clearcoatRoughness: 0.08,
    sheen: f.sheen ?? 0,
    sheenRoughness: 0.8,
    sheenColor: 0x8a9099,
    emissive: f.emissive ?? 0x000000,
    emissiveIntensity: f.emissive ? (f.emissiveIntensity ?? 1) : 0,
    transparent: see,
    opacity: f.opacity ?? 1,
    depthWrite: !see,
    envMap: env,
    envMapIntensity: f.envIntensity ?? 1,
    // Lathed and extruded pieces are closed but not all wound the same way; both sides keep them solid.
    side: DoubleSide,
  });
  m.name = f.name;
  return m;
}

/** A part type a builder knows: (part spec) → its assembly, in the part's own frame before rotation. */
export type LookBuilder = (part: PartShape, id: string) => Assembly;
