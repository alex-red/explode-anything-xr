/**
 * Remembering the desk spot (docs/WIN_PLAN.md W1/W4): the stage returns to the same place on the
 * real desk in the next session.
 *
 * IWSDK's SceneUnderstandingSystem keeps one persistent anchor at the origin of the reference
 * space and restores it in later sessions (its UUID lives in localStorage). The reference space
 * itself can move between sessions, the anchor does not. So the stage's pose is saved relative
 * to that anchor, together with the anchor's UUID, and mapped back through wherever the anchor
 * is now. Anything that does not line up (no anchor, a different anchor, nothing saved) means
 * "pick a desk as usual".
 */
import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/** The stage's pose on the desk: position and rotation about world up. */
export interface DeskPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** The current session's persistent anchor, as far as the app can see it. */
export interface AnchorFrame {
  /** The anchor's persistent UUID, or null while there is no usable, persisted anchor. */
  id(): string | null;
  /** The anchor's pose in world space; meaningful only while `id()` is not null. */
  matrix(): Matrix4;
}

interface Saved {
  anchor: string;
  /** Column-major 4×4: the stage's pose in the anchor's frame. */
  local: number[];
}

const STORAGE_KEY = 'explode:desk:v1';

export class DeskMemory {
  private readonly world = new Matrix4();
  private readonly local = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);

  /** Save `pose` relative to the anchor. Returns false (and saves nothing) without an anchor. */
  save(frame: AnchorFrame, pose: DeskPose): boolean {
    const id = frame.id();
    if (!id) return false;
    this.compose(pose, this.world);
    this.local.copy(this.inverse.copy(frame.matrix()).invert()).multiply(this.world);
    write({ anchor: id, local: this.local.toArray() });
    return true;
  }

  /**
   * Write the remembered pose, mapped through the anchor's current pose, to `out`. Returns false
   * when nothing is saved, there is no anchor yet, or the anchor is not the one it was saved with.
   */
  recall(frame: AnchorFrame, out: DeskPose): boolean {
    const saved = read();
    const id = frame.id();
    if (!saved || !id || saved.anchor !== id) return false;
    this.local.fromArray(saved.local);
    this.world.copy(frame.matrix()).multiply(this.local);
    this.world.decompose(this.pos, this.q, this.scale);
    out.x = this.pos.x;
    out.y = this.pos.y;
    out.z = this.pos.z;
    // Keep only the turn about world up: the stage always stands level.
    const e = this.world.elements;
    out.yaw = Math.atan2(e[8]!, e[10]!);
    return Number.isFinite(out.x + out.y + out.z + out.yaw);
  }

  /** True when a spot is saved (for any anchor). */
  static has(): boolean {
    return read() !== null;
  }

  static forget(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing was saved.
    }
  }

  private compose(pose: DeskPose, out: Matrix4): Matrix4 {
    this.q.setFromAxisAngle(this.up, pose.yaw);
    this.pos.set(pose.x, pose.y, pose.z);
    this.scale.set(1, 1, 1);
    return out.compose(this.pos, this.q, this.scale);
  }
}

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Saved>;
    return typeof s.anchor === 'string' && Array.isArray(s.local) && s.local.length === 16 && s.local.every(Number.isFinite) ? (s as Saved) : null;
  } catch {
    return null;
  }
}

function write(s: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, quota): the spot is simply not remembered.
  }
}

interface SceneUnderstandingLike {
  xrAnchor?: unknown;
  anchoredGroup?: { matrixWorld?: Matrix4; updateMatrixWorld?: (force?: boolean) => void };
}

/** localStorage key IWSDK 1.0.1 keeps the persistent anchor's UUID under. */
const SDK_ANCHOR_KEY = 'iwsdk_scene_anchor_uuid';

/**
 * The AnchorFrame of IWSDK 1.0.1's SceneUnderstandingSystem. It reads private fields (the active
 * anchor and the group that follows it), checks every one, and reports no anchor if the shape
 * differs; re-check it if the SDK version ever changes (it is pinned, see AGENTS.md).
 *
 * The anchor must have been present for a couple of frames before it counts: the SDK sets the
 * group's pose in its own update, which may run after the app's in the frame the anchor arrives,
 * and between sessions the group still holds the previous session's pose.
 */
export class SdkAnchorFrame implements AnchorFrame {
  private seenFrames = 0;
  private lastAnchor: unknown = null;
  private readonly identity = new Matrix4();

  constructor(private readonly system: unknown) {}

  /** Call once per frame. */
  tick(): void {
    const anchor = (this.system as SceneUnderstandingLike | null)?.xrAnchor ?? null;
    if (anchor && anchor === this.lastAnchor) this.seenFrames++;
    else this.seenFrames = anchor ? 1 : 0;
    this.lastAnchor = anchor;
  }

  id(): string | null {
    const group = (this.system as SceneUnderstandingLike | null)?.anchoredGroup;
    if (this.seenFrames < 3 || !group?.matrixWorld) return null;
    try {
      return localStorage.getItem(SDK_ANCHOR_KEY);
    } catch {
      return null;
    }
  }

  matrix(): Matrix4 {
    const group = (this.system as SceneUnderstandingLike | null)?.anchoredGroup;
    if (!group?.matrixWorld) return this.identity;
    group.updateMatrixWorld?.(true);
    return group.matrixWorld;
  }
}
