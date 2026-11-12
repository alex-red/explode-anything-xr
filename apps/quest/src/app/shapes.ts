import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  MathUtils,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector3,
} from '@iwsdk/core';
import type { GraphNode, PartShape } from '@explode/contracts';

/** Procedural geometry only (ADR-0019): nothing here needs a redistribution license. */
export function partGeometry(part: PartShape): BufferGeometry {
  const [x, y, z] = part.size;
  let g: BufferGeometry;
  switch (part.shape) {
    case 'box':
      g = new BoxGeometry(x, y, z);
      break;
    case 'cylinder':
      g = new CylinderGeometry(x / 2, x / 2, y, 24);
      break;
    case 'sphere':
      g = new SphereGeometry(x / 2, 20, 14);
      break;
    case 'torus':
      // size = [outer diameter, tube diameter, unused]; ring in local XY
      g = new TorusGeometry((x - y) / 2, Math.max(0.002, y / 2), 10, 28);
      break;
    case 'gear':
      g = gearGeometry(x / 2, y);
      break;
  }
  const [rx, ry, rz] = part.rotation_deg;
  g.applyQuaternion(new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz))));
  return g;
}

/** A gear: a cylinder whose rim vertices alternate in radius. Axis is +y. */
function gearGeometry(radius: number, thickness: number, teeth = 14): BufferGeometry {
  const g = new CylinderGeometry(radius, radius, thickness, teeth * 2, 1);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r > radius * 0.5) {
      const angle = Math.atan2(v.z, v.x);
      const tooth = Math.round(((angle + Math.PI) / (2 * Math.PI)) * teeth * 2) % 2 === 0;
      const scale = tooth ? 1 : 0.84;
      pos.setXYZ(i, v.x * scale, v.y, v.z * scale);
    }
  }
  g.computeVertexNormals();
  return g;
}

const shared = new Map<string, BufferGeometry>();

/** Which shared shape (and so which instanced batch) a software node is drawn with. */
export function softwareShape(node: Pick<GraphNode, 'kind' | 'role'>): 'concept' | 'entry' | 'hub' | 'engine' | 'cluster' | 'module' | 'leaf' {
  if (node.role) return node.role;
  return node.kind === 'cluster' || node.kind === 'module' ? node.kind : 'leaf';
}

/**
 * Shared low-poly geometry for software nodes, by shape. Special roles get their own silhouette,
 * so they can be told apart without colour:
 *
 * - a group (`concept` or a directory cluster) is a round shell;
 * - an entry point is a knot you could thread a path through;
 * - a hub is a spiked star, everything pointing at it;
 * - an engine, run every frame, is a gear, and turns.
 */
export function softwareGeometry(node: Pick<GraphNode, 'kind' | 'role'>): BufferGeometry {
  const key = softwareShape(node);
  let g = shared.get(key);
  if (!g) {
    switch (key) {
      case 'concept':
      case 'cluster':
        g = new IcosahedronGeometry(1, 2);
        break;
      case 'module':
        g = new IcosahedronGeometry(1, 1);
        break;
      case 'entry':
        g = new TorusKnotGeometry(0.72, 0.24, 48, 6);
        break;
      case 'hub':
        g = starGeometry();
        break;
      case 'engine':
        // Axis toward the viewer, so the teeth read from the front.
        g = gearGeometry(1, 0.32, 12).rotateX(Math.PI / 2);
        break;
      default:
        g = new IcosahedronGeometry(1, 0);
    }
    shared.set(key, g);
  }
  return g;
}

/** A stellated icosahedron: a spike raised on each of the twenty faces. Outer radius about 1.25. */
function starGeometry(): BufferGeometry {
  const base = new IcosahedronGeometry(0.62, 0); // already one vertex per face corner
  const src = base.getAttribute('position');
  const out = new Float32Array((src.count / 3) * 27);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const tip = new Vector3();
  let k = 0;
  const put = (...vs: Vector3[]) => {
    for (const v of vs) {
      out[k++] = v.x;
      out[k++] = v.y;
      out[k++] = v.z;
    }
  };
  for (let i = 0; i < src.count; i += 3) {
    a.fromBufferAttribute(src, i);
    b.fromBufferAttribute(src, i + 1);
    c.fromBufferAttribute(src, i + 2);
    tip.copy(a).add(b).add(c).normalize().multiplyScalar(1.25);
    put(a, b, tip, b, c, tip, c, a, tip);
  }
  base.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
