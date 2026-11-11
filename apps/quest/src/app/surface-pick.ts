/**
 * Choosing the desk: which detected surface the projector stage should stand on (docs/WIN_PLAN.md W1).
 *
 * Pure numbers, no three.js and no allocation, so it is testable headless and safe to call from
 * a frame. `room.ts` fills the `Surface` list from the headset's plane detection; the app falls
 * back to its floating placement whenever this returns false.
 */

/** A detected flat surface, reduced to an oriented rectangle in world space. */
export interface Surface {
  /** Centre of the rectangle, world metres. `y` is the height of the surface. */
  x: number;
  y: number;
  z: number;
  /** Half extents along the surface's own x and z axes. */
  halfW: number;
  halfD: number;
  /** Rotation of the surface's x axis about world up, radians. */
  yaw: number;
  /** False for walls and anything tilted; those are never picked. */
  horizontal: boolean;
  /** Semantic label from the runtime, lower case; '' when it gave none. */
  label: string;
}

/** The seated viewer: eye position and the horizontal direction they face (unit length). */
export interface Viewer {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
}

/** Where the stage goes: a point on the chosen surface, and which surface it was. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  index: number;
}

export interface PickConfig {
  /** How far in front of the eyes the stage wants to be, metres. */
  reach: number;
  /** The surface must be this far below the eyes, or the model would sit in the viewer's face. */
  minBelowEye: number;
  /** ...and no further below than this, or they would be looking at their lap (this also excludes the floor). */
  maxBelowEye: number;
  /** Smallest half extent worth standing a 27 cm stage on. */
  minHalf: number;
  /** Keep the stage centre this far inside the surface's edge. */
  inset: number;
  /** How far the wanted point may be pulled sideways to land on the surface. */
  maxSlip: number;
  /** Final horizontal distance from the eyes must stay inside seated reach. */
  minDistance: number;
  maxDistance: number;
  /** Score bonus (metres of slip forgiven) for a surface the runtime calls a table or desk. */
  tableBonus: number;
}

export const DEFAULT_PICK: PickConfig = {
  reach: 0.65, // close to the floating placement (0.7 m), so the toolbar beside the stage stays near the centre of view
  minBelowEye: 0.25,
  maxBelowEye: 0.65,
  minHalf: 0.15,
  inset: 0.12,
  maxSlip: 0.35,
  minDistance: 0.3,
  maxDistance: 0.85,
  tableBonus: 0.1,
};

const NEVER = new Set(['floor', 'ceiling', 'wall', 'door', 'window', 'global mesh']);
const TABLES = new Set(['table', 'desk']);

export function newSurface(): Surface {
  return { x: 0, y: 0, z: 0, halfW: 0, halfD: 0, yaw: 0, horizontal: false, label: '' };
}

/**
 * Pick the surface to stand the stage on, considering the first `count` entries of `surfaces`.
 * Writes the result to `out` and returns true, or returns false (leaving `out` untouched) when
 * nothing suitable is in front of the viewer.
 */
export function pickSurface(surfaces: readonly Surface[], count: number, viewer: Viewer, out: Placement, cfg: PickConfig = DEFAULT_PICK): boolean {
  const wantX = viewer.x + viewer.fx * cfg.reach;
  const wantZ = viewer.z + viewer.fz * cfg.reach;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  let bi = -1;
  const n = Math.min(count, surfaces.length);
  for (let i = 0; i < n; i++) {
    const s = surfaces[i]!;
    if (!s.horizontal || NEVER.has(s.label)) continue;
    const below = viewer.y - s.y;
    if (below < cfg.minBelowEye || below > cfg.maxBelowEye) continue;
    if (s.halfW < cfg.minHalf || s.halfD < cfg.minHalf) continue;
    // The wanted point in the surface's own frame, clamped inside its inset rectangle.
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const dx = wantX - s.x;
    const dz = wantZ - s.z;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const limW = Math.max(0, s.halfW - cfg.inset);
    const limD = Math.max(0, s.halfD - cfg.inset);
    const cx = Math.min(limW, Math.max(-limW, lx));
    const cz = Math.min(limD, Math.max(-limD, lz));
    const slip = Math.hypot(lx - cx, lz - cz);
    if (slip > cfg.maxSlip) continue;
    const px = s.x + cx * cos + cz * sin;
    const pz = s.z - cx * sin + cz * cos;
    const distance = Math.hypot(px - viewer.x, pz - viewer.z);
    if (distance < cfg.minDistance || distance > cfg.maxDistance) continue;
    const score = slip - (TABLES.has(s.label) ? cfg.tableBonus : 0);
    if (score < best) {
      best = score;
      bx = px;
      by = s.y;
      bz = pz;
      bi = i;
    }
  }
  if (bi < 0) return false;
  out.x = bx;
  out.y = by;
  out.z = bz;
  out.index = bi;
  return true;
}
