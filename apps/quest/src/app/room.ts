import { createSystem, XRPlane, type Object3D } from '@iwsdk/core';
import { newSurface, pickSurface, type Placement, type Surface, type Viewer } from './surface-pick.ts';

const HORIZONTAL_MIN_UP = 0.9; // |y| of the plane's normal; steeper than about 25° is not a desk

/** What the SDK stores on an XRPlane entity: the WebXR plane the headset detected. */
interface DetectedPlane {
  polygon: readonly { x: number; z: number }[];
  semanticLabel?: string;
}

/**
 * The real room, as far as the headset describes it (docs/WIN_PLAN.md W1). The SDK's
 * SceneUnderstandingSystem turns each detected plane into an entity; this system reduces those
 * to rectangles and answers one question for the app: is there a desk in front of the viewer
 * to stand the stage on?
 *
 * It finds nothing, and the app keeps its floating placement, whenever plane detection was not
 * granted, the room was never set up, or the session is not mixed reality.
 */
export class RoomSystem extends createSystem({ planes: { required: [XRPlane] } }) {
  private surfaces: Surface[] = [];
  /** Called when the headset reports a plane it had not reported before. */
  onPlaneAdded: (() => void) | null = null;

  init(): void {
    this.cleanupFuncs.push(this.queries.planes.subscribe('qualify', () => this.onPlaneAdded?.()));
  }

  get planeCount(): number {
    return this.queries.planes.entities.size;
  }

  /** Writes the desk placement to `out` and returns true, or returns false when there is none. */
  pickDesk(viewer: Viewer, out: Placement): boolean {
    let count = 0;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as DetectedPlane | undefined;
      const object = entity.object3D;
      if (!plane || !object) continue;
      if (count === this.surfaces.length) this.surfaces.push(newSurface()); // grows only on the first calls
      fillSurface(this.surfaces[count]!, object, plane);
      count++;
    }
    return pickSurface(this.surfaces, count, viewer, out);
  }
}

/** Reduce a plane (pose on `object`, outline in the plane's own x/z) to a world-space rectangle. */
function fillSurface(s: Surface, object: Object3D, plane: DetectedPlane): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of plane.polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const empty = minX > maxX;
  // The SDK writes the plane's pose straight onto the object, in world space.
  object.updateMatrix();
  const m = object.matrix.elements;
  // Columns of the pose: the plane's x axis (m0..m2), its normal (m4..m6), its position (m12..m14).
  const yaw = Math.atan2(-m[2]!, m[0]!);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const cx = empty ? 0 : (minX + maxX) / 2;
  const cz = empty ? 0 : (minZ + maxZ) / 2;
  s.x = m[12]! + cx * cos + cz * sin;
  s.y = m[13]!;
  s.z = m[14]! - cx * sin + cz * cos;
  s.halfW = empty ? 0 : (maxX - minX) / 2;
  s.halfD = empty ? 0 : (maxZ - minZ) / 2;
  s.yaw = yaw;
  s.horizontal = Math.abs(m[5]!) >= HORIZONTAL_MIN_UP;
  s.label = (plane.semanticLabel ?? '').toLowerCase();
}
