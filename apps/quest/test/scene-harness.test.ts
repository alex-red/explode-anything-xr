/**
 * Headless scene harness: runs the real ExplodeApp / GraphView / SpatialUI / TwoHandPull code
 * against a stub IWSDK World and a recording 2D canvas (no WebGL, no dev server, no build).
 * Presses go through the same handler registry InteractionSystem uses for XR rays and mouse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventDispatcher, Group, Mesh, MathUtils, Object3D, PerspectiveCamera, Scene, Vector3, VisibilityState, signal } from '@iwsdk/core';
import { ContentBundle } from '@explode/contracts';
import drivetrainJson from '../src/content/drivetrain.bundle.json';
import repoJson from '../src/content/repo-demo.bundle.json';
import { startApp, type ExplodeApp } from '../src/app/app.ts';
import { firePress, isInteractive } from '../src/app/interactions.ts';
import { TextPanel } from '../src/app/text.ts';

const bundles = [ContentBundle.parse(drivetrainJson), ContentBundle.parse(repoJson)];

// ---------------------------------------------------------------- DOM stubs

const canvasText = new WeakMap<object, string[]>();
function fakeCanvas() {
  const canvas: Record<string, unknown> = { width: 0, height: 0 };
  let lines: string[] = [];
  let font = '40px sans';
  const ctx = {
    set font(f: string) {
      font = f;
    },
    get font() {
      return font;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: 'top',
    textAlign: 'left',
    clearRect: () => {
      lines = [];
      canvasText.set(canvas, lines);
    },
    beginPath: () => undefined,
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillText: (t: string) => lines.push(t),
    measureText: (t: string) => ({ width: t.length * (Number(/(\d+)px/.exec(font)?.[1] ?? 40) * 0.55) }),
  };
  canvas.getContext = () => ctx;
  canvasText.set(canvas, lines);
  return canvas;
}

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

const keyListeners: Array<(e: { key: string }) => void> = [];
let clock = 0;

beforeEach(() => {
  TextPanel.clipEvents = [];
  clock = 0;
  keyListeners.length = 0;
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  vi.stubGlobal('window', { addEventListener: (t: string, fn: (e: { key: string }) => void) => t === 'keydown' && keyListeners.push(fn) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- world stub

interface StubEntity {
  object3D: Object3D;
  components: unknown[];
  addComponent(c: unknown): void;
  dispose(): void;
}

function makeWorld() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(90, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.5);
  scene.add(camera);
  const player = { gripSpaces: { left: new Group(), right: new Group() } };
  scene.add(player.gripSpaces.left, player.gripSpaces.right);
  const xr = Object.assign(new EventDispatcher<{ sessionstart: object; sessionend: object }>(), { session: null as unknown, getSession: () => xr.session });
  const entities = new Set<StubEntity>();
  const world = {
    scene,
    camera,
    player,
    session: undefined as unknown,
    xrEnabled: true,
    renderer: { xr },
    visibilityState: signal<VisibilityState>(VisibilityState.NonImmersive),
    systems: [] as unknown[],
    registerSystem(s: unknown) {
      this.systems.push(s);
    },
    launchXR() {},
    createTransformEntity(object: Object3D, opts?: { parent?: StubEntity }) {
      (opts?.parent?.object3D ?? scene).add(object);
      const e: StubEntity = {
        object3D: object,
        components: [],
        addComponent(c) {
          this.components.push(c);
        },
        dispose() {
          object.removeFromParent();
          entities.delete(e);
        },
      };
      entities.add(e);
      return e;
    },
  };
  return { world, scene, camera, xr, entities };
}

// ---------------------------------------------------------------- helpers

function setup() {
  const w = makeWorld();
  const app = startApp(w.world as never, bundles, null);
  const frames = (n = 30) => {
    for (let i = 0; i < n; i++) {
      w.scene.updateMatrixWorld(true);
      app.update(1 / 72);
    }
  };
  const press = (obj: Object3D | undefined) => {
    expect(obj, 'target to press').toBeDefined();
    expect(isInteractive(obj!)).toBe(true);
    clock += 300; // beyond the press debounce
    firePress(obj!);
    frames(20);
  };
  /** All text currently drawn on each interactive or panel mesh. */
  const panels = () => {
    const out: Array<{ mesh: Mesh; text: string }> = [];
    w.scene.traverse((o) => {
      const m = o as Mesh & { material?: { map?: { image?: object } } };
      const img = m.material?.map?.image;
      if (img && canvasText.has(img)) out.push({ mesh: m, text: canvasText.get(img)!.join(' ') });
    });
    return out;
  };
  const button = (label: RegExp) => panels().find((p) => isInteractive(p.mesh) && label.test(p.text))?.mesh;
  const caption = () => panels().map((p) => p.text).find((t) => /\d+\/\d+|Lesson complete|Tutorial complete|Free exploration/.test(t)) ?? '';
  const internals = app as unknown as {
    store: ExplodeApp extends never ? never : { state: import('@explode/contracts').SceneState; systemId: string; log: unknown[] };
    view: { nodes: Map<string, { mesh: Mesh }>; edges: Map<string, { plug: { mesh: Mesh } | null }>; sockets: Array<{ mesh: Mesh; targetId: string }>; displayFactor: number };
  };
  frames(5);
  return { ...w, app, frames, press, button, caption, panels, state: () => internals.store.state, store: () => internals.store, view: () => internals.view };
}

function expectFinite(scene: Scene) {
  scene.traverse((o) => {
    expect(Number.isFinite(o.position.x + o.position.y + o.position.z), `finite position for ${o.type}`).toBe(true);
    expect(Number.isFinite(o.scale.x + o.scale.y + o.scale.z)).toBe(true);
  });
}

// ---------------------------------------------------------------- tests

describe('scene harness: drivetrain tutorial', () => {
  it('runs the whole tutorial through in-world presses and switches to the software system', () => {
    const h = setup();
    expect(h.state().system_id).toBe('system:ev-drivetrain');
    expect(h.caption()).toMatch(/simplified EV drivetrain/);

    h.press(h.button(/^Explode$/));
    h.frames(60);
    expect(h.state().explode_factor).toBe(1);
    expect(h.view().displayFactor).toBeGreaterThan(0.95);
    expect(h.caption()).toMatch(/Trace/);

    h.press(h.button(/^Trace/));
    expect(h.caption()).toMatch(/Unplug the cable/);

    const plug = h.view().edges.get('edge:powers:part:inverter->part:motor')!.plug!.mesh;
    expect(plug.visible).toBe(true);
    h.press(plug);
    expect(h.state().broken_edge_ids).toEqual(['edge:powers:part:inverter->part:motor']);
    // Prediction step: the consequence must not be revealed yet.
    expect(h.caption()).toMatch(/Which part stops first/);
    expect(h.caption()).not.toMatch(/TEACHING MODEL/);

    h.press(h.view().nodes.get('part:motor')!.mesh);
    expect(h.state().prediction).toEqual({ target_id: 'part:motor', correct: true });
    expect(h.caption()).toMatch(/TEACHING MODEL/); // consequence now shown, labeled honestly

    h.press(h.button(/^Next/));
    expect(h.view().sockets.map((s) => s.targetId).sort()).toEqual(['part:battery', 'part:gearbox', 'part:motor']);
    h.press(h.view().sockets.find((s) => s.targetId === 'part:battery')!.mesh); // wrong socket
    expect(h.state().misplug_count).toBe(1);
    expect(h.caption()).toMatch(/doesn't accept/);
    h.press(h.view().sockets.find((s) => s.targetId === 'part:motor')!.mesh);
    expect(h.state().broken_edge_ids).toEqual([]);

    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(h.state().lesson?.status).toBe('complete');
    expect(h.caption()).toMatch(/Tutorial complete/);

    h.press(h.button(/Continue: software/));
    expect(h.state().system_id).toBe('system:auth-service');
    expectFinite(h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('explodes with a two-hand pinch-and-pull', () => {
    const h = setup();
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), {});
    (h.xr as unknown as { session: unknown }).session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    const fire = (type: string, handedness: string) => session.dispatchEvent({ type, inputSource: { handedness } } as never);
    h.world.player.gripSpaces.left.position.set(-0.05, 1, 0);
    h.world.player.gripSpaces.right.position.set(0.05, 1, 0);
    h.frames(2);
    fire('selectstart', 'left');
    fire('selectstart', 'right');
    h.frames(2);
    h.world.player.gripSpaces.left.position.set(-0.2, 1, 0);
    h.world.player.gripSpaces.right.position.set(0.2, 1, 0); // +30 cm apart
    h.frames(10);
    expect(h.view().displayFactor).toBeGreaterThan(0.3); // live preview while pulling
    expect(h.state().explode_factor).toBe(0); // not committed until release
    fire('selectend', 'right');
    h.frames(10);
    expect(h.state().explode_factor).toBe(1); // snapped and committed
    expect(h.caption()).toMatch(/Trace/); // lesson advanced
  });
});

describe('scene harness: software hero lesson', () => {
  it('runs trace → evidence → predict → break → observe → repair → reflect', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    expect(h.state().system_id).toBe('system:auth-service');
    expect(h.caption()).toMatch(/written as a sample for EXPLODE/);

    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    expect(h.state().active_path_id).toBe('path:login-request');
    expect(h.caption()).toMatch(/open its evidence/);

    h.press(h.button(/^Evidence$/));
    const evidenceText = h.panels().find((p) => p.text.startsWith('EVIDENCE'))?.text ?? '';
    expect(evidenceText).toMatch(/IN SOURCE/);
    expect(evidenceText).toMatch(/src\/.*\.ts:\d+-\d+ @/);

    expect(h.caption()).toMatch(/which step fails first/i);
    h.press(h.view().nodes.get('fn:src/sessions/store.ts#sessionstore.create')!.mesh);
    expect(h.state().prediction?.correct).toBe(true);

    const BREAK = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
    h.press(h.view().edges.get(BREAK)!.plug!.mesh);
    expect(h.state().consequences[0]?.truth_status).toBe('observed');
    expect(h.caption()).toMatch(/OBSERVED/);
    const ev = h.panels().find((p) => p.text.startsWith('EVIDENCE'))?.text ?? '';
    expect(ev).toMatch(/real repository was not modified/);
    expect(ev).toMatch(/failing/);

    h.press(h.button(/^Next/));
    const sockets = h.view().sockets;
    expect(sockets).toHaveLength(3);
    h.press(sockets.find((s) => s.targetId === 'fn:src/sessions/store.ts#sessionstore.create')!.mesh);
    expect(h.state().broken_edge_ids).toEqual([]);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');
    expect(h.caption()).toMatch(/Lesson complete/);
    expectFinite(h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('answers tutor buttons offline with grounded, labeled text', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.view().nodes.get('fn:src/auth/service.ts#authservice.login')!.mesh);
    expect(h.state().selected_id).toBe('fn:src/auth/service.ts#authservice.login');
    h.press(h.button(/Explain this/));
    return vi.waitFor(() => {
      h.frames(5);
      expect(h.caption()).toMatch(/Guide \(offline\)/);
      expect(h.caption()).toMatch(/AuthService\.login/);
    });
  });

  it('keeps the exploded layout inside the 60°×50° cone and labels capped at 30', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    const cam = new Vector3();
    h.camera.getWorldPosition(cam);
    let maxH = 0;
    let maxV = 0;
    let labels = 0;
    for (const v of h.view().nodes.values()) {
      const p = v.mesh.getWorldPosition(new Vector3()).sub(cam);
      maxH = Math.max(maxH, Math.abs(MathUtils.radToDeg(Math.atan2(p.x, -p.z))));
      maxV = Math.max(maxV, Math.abs(MathUtils.radToDeg(Math.atan2(p.y, -p.z))));
      expect(p.length(), 'within seated reach').toBeLessThan(0.9);
    }
    for (const v of h.view().nodes.values() as Iterable<{ label: { mesh: Mesh } | null }>) if (v.label?.mesh.visible) labels++;
    expect(maxH).toBeLessThanOrEqual(30);
    expect(maxV).toBeLessThanOrEqual(25);
    expect(labels).toBeGreaterThan(5);
    expect(labels).toBeLessThanOrEqual(30);
  });

  it('restores the same step after a killed session, and pauses when blurred', () => {
    const h = setup();
    h.press(h.button(/^Explode$/));
    h.frames(30);
    const before = h.state();
    const h2 = setup(); // same localStorage → relaunch
    expect(h2.state()).toEqual(before);
    h2.world.visibilityState.value = VisibilityState.VisibleBlurred;
    const f = h2.view().displayFactor;
    h2.store().state; // no-op read
    h2.frames(10);
    expect(h2.view().displayFactor).toBe(f);
  });

  it('switching systems disposes the previous view', () => {
    const h = setup();
    const before = h.entities.size;
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/◂ Car/));
    h.frames(5);
    expect(h.entities.size).toBe(before);
  });
});
