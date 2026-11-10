import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  MathUtils,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
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

/** Shared low-poly geometry for software nodes, by kind. */
export function softwareGeometry(node: GraphNode): BufferGeometry {
  const key = node.kind;
  let g = shared.get(key);
  if (!g) {
    g = node.kind === 'cluster' ? new IcosahedronGeometry(1, 2) : node.kind === 'module' ? new IcosahedronGeometry(1, 1) : new IcosahedronGeometry(1, 0);
    shared.set(key, g);
  }
  return g;
}
