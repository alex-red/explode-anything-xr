import { AdditiveBlending, BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3, type Entity, type World } from '@iwsdk/core';
import { COLOR, CSS } from './palette.ts';
import type { LoadProgress } from './projects.ts';
import { TextPanel } from './text.ts';

const TICKS = 60;
const RADIUS = 0.11;
/** Seconds to grow in, and to fold away into the stage once the model is ready. */
const IN_SECONDS = 0.35;
const OUT_SECONDS = 0.45;
/** 1/s: how fast the shown fraction catches up with the real one, so the dial never jumps. */
const CATCH_UP = 8;
/** Where it stands in the anchor's frame: where the model will be. */
const AT = new Vector3(0, 0.02, 0);

const IDLE = new Color(COLOR.dim).multiplyScalar(1.6);
const LIT = new Color(COLOR.action);
const HEAD = new Color(0xffffff);
const FAIL = new Color(COLOR.fault);

const PHASE_TEXT: Record<LoadProgress['phase'], string> = {
  fetch: 'Downloading its parts',
  check: 'Checking it against the contract',
  build: 'Building the model',
};

/**
 * What stands on the stage while a project's bundle is on its way: a dial of sixty ticks that
 * fills as the bytes arrive (a sweeping comet when the size is not known), two counter-turning
 * arcs inside it, and a panel saying what is being loaded and how far it has got. It grows out of
 * the stage, and folds back into it with a flash once the model is ready to boot. One panel
 * texture, three draw calls besides; nothing allocated per frame.
 */
export class LoadingView {
  readonly group = new Group();
  private readonly dial = new Group();
  private readonly ticks: InstancedMesh;
  private readonly arcs: Mesh<TorusGeometry, MeshBasicMaterial>[] = [];
  private readonly flash: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly panel: TextPanel;
  private readonly tickMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false });
  private readonly arcMat = new MeshBasicMaterial({ color: COLOR.stage, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false });
  private readonly flashMat = new MeshBasicMaterial({ color: COLOR.action, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly c = new Color();
  private readonly z = new Vector3(0, 0, 1);

  private name = '';
  private progress: LoadProgress = { phase: 'fetch', fraction: 0, bytes: 0 };
  private shownFraction = 0;
  private failed: string | null = null;
  private time = 0;
  /** 0 → 1 growing in; then held at 1. */
  private grow = 0;
  /** > 0 while folding away; counts down. */
  private out = 0;
  private active = false;
  private textClock = 1;
  /** Seconds it has been on the stage this time (the app keeps it up long enough to be read). */
  shownFor = 0;

  constructor(world: World, parent: Entity) {
    world.createTransformEntity(this.group, { parent });
    this.group.position.copy(AT);
    this.group.add(this.dial);
    this.ticks = new InstancedMesh(new BoxGeometry(0.004, 0.016, 0.002), this.tickMat, TICKS);
    this.ticks.frustumCulled = false;
    this.dial.add(this.ticks);
    for (const [r, arc] of [
      [RADIUS * 0.78, Math.PI * 0.6],
      [RADIUS * 0.66, Math.PI * 1.1],
    ] as const) {
      const mesh = new Mesh(new TorusGeometry(r, 0.0016, 6, 64, arc), this.arcMat);
      this.arcs.push(mesh);
      this.dial.add(mesh);
    }
    this.flash = new Mesh(new TorusGeometry(RADIUS, 0.004, 6, 96), this.flashMat);
    this.dial.add(this.flash);
    this.panel = new TextPanel({ width: 0.17, height: 0.075, pxPerMeter: 2800, background: null, border: null, padding: 6, align: 'center' });
    this.panel.mesh.position.set(0, 0, 0.002);
    this.dial.add(this.panel.mesh);
    for (const o of [this.ticks, this.flash, this.panel.mesh, ...this.arcs]) o.renderOrder = 19;
    this.hideNow();
  }

  get visible(): boolean {
    return this.active;
  }

  /** Put the dial up for `name`. */
  show(name: string): void {
    this.name = name;
    this.failed = null;
    this.progress = { phase: 'fetch', fraction: 0, bytes: 0 };
    this.shownFraction = 0;
    this.active = true;
    this.grow = 0;
    this.out = 0;
    this.shownFor = 0;
    this.textClock = 1;
    this.group.visible = true;
  }

  set(progress: LoadProgress): void {
    this.progress = progress;
  }

  /** The load failed: the dial turns coral and says so. */
  fail(message: string): void {
    this.failed = message;
    this.textClock = 1;
  }

  /** Fold away into the stage with a flash: the model is about to boot in its place. */
  finish(): void {
    if (!this.active || this.out > 0) return;
    this.progress = { ...this.progress, fraction: 1 };
    this.shownFraction = 1;
    this.out = OUT_SECONDS;
  }

  /** Once a frame. `eye` is in the anchor's frame; the dial turns to face it. No allocation. */
  update(dt: number, eye: Vector3): void {
    if (!this.active) return;
    this.time += dt;
    this.shownFor += dt;
    this.grow = Math.min(1, this.grow + dt / IN_SECONDS);
    if (this.out > 0) {
      this.out = Math.max(0, this.out - dt);
      if (this.out === 0) {
        this.hideNow();
        return;
      }
    }
    this.dial.rotation.set(0, Math.atan2(eye.x - AT.x, eye.z - AT.z), 0);
    const leaving = this.out > 0 ? this.out / OUT_SECONDS : 1; // 1 → 0 while folding away
    const g = 1 - (1 - this.grow) ** 3;
    // Grows up out of the stage; folds down and shrinks back into it.
    this.dial.scale.setScalar(Math.max(1e-4, g * (0.4 + 0.6 * leaving)));
    this.dial.position.y = -0.12 * (1 - g) - 0.08 * (1 - leaving);

    const want = this.progress.fraction ?? 0;
    this.shownFraction += (want - this.shownFraction) * Math.min(1, dt * CATCH_UP);
    const known = this.progress.fraction !== null || this.out > 0;
    const sweep = (this.time * 0.9) % 1; // the comet's head, as a fraction of the dial
    for (let i = 0; i < TICKS; i++) {
      const at = i / TICKS;
      const angle = Math.PI / 2 - at * Math.PI * 2; // clockwise from twelve o'clock
      this.p.set(Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS, 0);
      this.q.setFromAxisAngle(this.z, angle - Math.PI / 2);
      let lit: number;
      if (this.failed) lit = 0.5 + 0.2 * Math.sin(this.time * 6);
      else if (known) lit = at < this.shownFraction ? 1 : 0;
      else lit = Math.max(0, 1 - ((sweep - at + 1) % 1) * 4); // a tail behind the head
      const length = 0.6 + 0.6 * lit;
      this.s.set(1, length, 1);
      this.ticks.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      const head = known && !this.failed && Math.abs(at - this.shownFraction) < 1 / TICKS;
      this.c.copy(this.failed ? FAIL : IDLE).lerp(this.failed ? FAIL : LIT, lit);
      if (head) this.c.copy(HEAD);
      this.ticks.setColorAt(i, this.c.multiplyScalar(leaving));
    }
    this.ticks.instanceMatrix.needsUpdate = true;
    if (this.ticks.instanceColor) this.ticks.instanceColor.needsUpdate = true;
    this.arcs[0]!.rotation.z = this.time * 2.1;
    this.arcs[1]!.rotation.z = -this.time * 1.4;
    this.arcMat.opacity = 0.7 * leaving * g;
    this.arcMat.color.set(this.failed ? COLOR.fault : COLOR.stage);
    // The flash: a ring thrown outward as the dial folds away.
    const f = this.out > 0 ? 1 - leaving : 0;
    this.flash.scale.setScalar(1 + f * 1.6);
    this.flashMat.opacity = f > 0 ? (1 - f) * 0.9 : 0;
    this.panel.mesh.material.opacity = leaving * g;

    // The text changes at most ten times a second: each change is a texture upload.
    this.textClock += dt;
    if (this.textClock >= 0.1) {
      this.textClock = 0;
      this.drawText();
    }
  }

  private drawText(): void {
    if (this.failed) {
      this.panel.draw([
        { text: 'COULD NOT LOAD', size: 26, bold: true, color: CSS.fault, gap: 4 },
        { text: this.name, size: 40, bold: true, gap: 4 },
        { text: this.failed, size: 24, color: CSS.muted },
      ]);
      return;
    }
    const pr = this.progress;
    const pct = this.out > 0 ? 'ready' : pr.fraction !== null && pr.phase === 'fetch' ? `${Math.round(this.shownFraction * 100)}%` : '';
    const kb = pr.bytes > 0 ? `${Math.round(pr.bytes / 1024)} KB` : '';
    const detail = [this.out > 0 ? 'Booting' : PHASE_TEXT[pr.phase], pct, kb].filter(Boolean).join('  ·  ');
    this.panel.draw([
      { text: 'LOADING', size: 26, bold: true, color: CSS.action, gap: 4 },
      { text: this.name, size: 40, bold: true, gap: 4 },
      { text: detail, size: 24, color: CSS.muted },
    ]);
  }

  private hideNow(): void {
    this.active = false;
    this.group.visible = false;
    this.flashMat.opacity = 0;
  }

  dispose(): void {
    this.ticks.geometry.dispose();
    this.ticks.dispose();
    for (const a of this.arcs) a.geometry.dispose();
    this.flash.geometry.dispose();
    this.tickMat.dispose();
    this.arcMat.dispose();
    this.flashMat.dispose();
    this.panel.dispose();
  }
}
