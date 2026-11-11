/**
 * Headless scene harness: runs the real ExplodeApp / GraphView / SpatialUI / HandGestures code
 * against a stub IWSDK World and a recording 2D canvas (no WebGL, no dev server, no build).
 * Presses go through the same handler registry InteractionSystem uses for XR rays and mouse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Euler, EventDispatcher, Group, Matrix4, Mesh, Quaternion, MathUtils, Object3D, PerspectiveCamera, Scene, Vector3, VisibilityState, signal, type SphereGeometry } from '@iwsdk/core';
import { ContentBundle } from '@explode/contracts';
import drivetrainJson from '../src/content/drivetrain.bundle.json';
import headsetJson from '../src/content/headset.bundle.json';
import repoJson from '../src/content/repo-demo.bundle.json';
import { startApp, type ExplodeApp } from '../src/app/app.ts';
import { firePress, isInteractive, pressEnd, pressStart } from '../src/app/interactions.ts';
import { TextPanel } from '../src/app/text.ts';
import { FakeAudioContext } from './fake-audio.ts';
import { FOV_BUDGET } from '../src/app/fov.ts';

const bundles = [ContentBundle.parse(drivetrainJson), ContentBundle.parse(repoJson)];
/** The shipped set (src/index.ts): the headset opens, the drivetrain is under "More". */
const shipped = [ContentBundle.parse(headsetJson), ContentBundle.parse(drivetrainJson), ContentBundle.parse(repoJson)];

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
    lineTo: () => undefined,
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
    renderer: { xr, info: { render: { calls: 123, triangles: 4567 }, memory: { geometries: 8, textures: 9 } } },
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

function setup(debug = false, opts: { bundles?: ContentBundle[]; room?: unknown; anchors?: unknown } = {}) {
  const w = makeWorld();
  const app = startApp(w.world as never, opts.bundles ?? bundles, null, debug, (opts.room ?? null) as never, (opts.anchors ?? null) as never);
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
  const button = (label: RegExp) => panels().find((p) => isInteractive(p.mesh) && p.mesh.visible && label.test(p.text))?.mesh;
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
    // A ray aimed at a socket lands on the part inside the ring; that must count as the socket.
    h.press(h.view().nodes.get('part:gearbox')!.mesh);
    expect(h.state().misplug_count).toBe(2);
    expect(h.state().selected_id).toBeNull();
    h.press(h.view().nodes.get('part:motor')!.mesh);
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

describe('scene harness: pinch presses', () => {
  function withSession(h: ReturnType<typeof setup>) {
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    const fire = (type: string, handedness: string) => session.dispatchEvent({ type, inputSource: { handedness } } as never);
    return { session, fire };
  }

  it('delivers a press on release, not when the pinch starts', () => {
    const h = setup();
    const explode = h.button(/^Explode$/)!;
    clock += 300;
    pressStart(explode);
    h.frames(5);
    expect(h.state().explode_factor).toBe(0);
    pressEnd(explode);
    h.frames(5);
    expect(h.state().explode_factor).toBe(1);
  });

  it('the first hand of a two-hand pull never selects, presses a button, or predicts', () => {
    const h = setup();
    const { fire } = withSession(h);
    h.world.player.gripSpaces.left.position.set(-0.05, 1, 0);
    h.world.player.gripSpaces.right.position.set(0.05, 1, 0);
    h.press(h.button(/^Explode$/));
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get('edge:powers:part:inverter->part:motor')!.plug!.mesh);
    expect(h.caption()).toMatch(/Which part stops first/); // predict step: any node press would commit
    const logBefore = h.store().log.length;

    clock += 300;
    const battery = h.view().nodes.get('part:battery')!.mesh;
    const next = h.button(/^Next/)!;
    fire('selectstart', 'left');
    pressStart(battery); // left ray happened to be on a part
    fire('selectstart', 'right');
    pressStart(next); // right ray happened to be on a button
    h.frames(3); // pull engages
    fire('selectend', 'left');
    pressEnd(battery);
    h.frames(3);
    fire('selectend', 'right');
    pressEnd(next);
    h.frames(3);

    expect(h.state().prediction).toBeNull();
    expect(h.state().selected_id).toBeNull();
    expect(h.store().log.length).toBe(logBefore);

    // A normal single-hand pinch still works afterwards.
    h.press(h.view().nodes.get('part:motor')!.mesh);
    expect(h.state().prediction).toEqual({ target_id: 'part:motor', correct: true });
  });

  it('pinches that start far apart in time stay separate presses', () => {
    const h = setup();
    const { fire } = withSession(h);
    fire('selectstart', 'left');
    clock += 900;
    fire('selectstart', 'right');
    const explode = h.button(/^Explode$/)!;
    pressStart(explode);
    h.frames(3);
    fire('selectend', 'right');
    pressEnd(explode);
    h.frames(3);
    expect(h.state().explode_factor).toBe(1);
  });

  it('says so when no hand or controller is tracked, and clears the hint when one returns', () => {
    const h = setup();
    const { session } = withSession(h);
    h.frames(72 * 2);
    expect(h.caption()).not.toMatch(/can't see your hands/);
    session.inputSources = [];
    h.frames(72 * 5);
    expect(h.caption()).toMatch(/can't see your hands/);
    session.inputSources = [{}];
    h.frames(30);
    expect(h.caption()).not.toMatch(/can't see your hands/);
  });
});

describe('scene harness: session backdrop', () => {
  const start = (h: ReturnType<typeof setup>, blend: string) => {
    (h.xr as unknown as { session: unknown }).session = { environmentBlendMode: blend, addEventListener: () => undefined };
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
  };
  const backdrop = (h: ReturnType<typeof setup>) => (h.app as unknown as { backdrop: { mode: string; passthroughAvailable: boolean } }).backdrop;

  it('an opaque (VR) session gets the virtual backdrop and locks the View toggle', () => {
    const h = setup();
    start(h, 'opaque');
    expect(backdrop(h).mode).toBe('virtual');
    const view = h.button(/^View: virtual$/);
    expect(view).toBeDefined();
    h.press(view);
    expect(backdrop(h).mode).toBe('virtual'); // disabled: cannot switch to a passthrough that is not there

    h.xr.dispatchEvent({ type: 'sessionend' });
    h.frames(20);
    expect(backdrop(h).mode).toBe('passthrough');
  });

  it('a session that blends with the room keeps passthrough and a working toggle', () => {
    const h = setup();
    start(h, 'alpha-blend');
    expect(backdrop(h).mode).toBe('passthrough');
    h.press(h.button(/^View: passthrough$/));
    expect(backdrop(h).mode).toBe('dim');
  });
});

describe('scene harness: handling the model with the hands', () => {
  function withHands(h: ReturnType<typeof setup>) {
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20); // session-start recenter
    const fire = (type: string, handedness: string) => session.dispatchEvent({ type, inputSource: { handedness } } as never);
    const { left, right } = h.world.player.gripSpaces;
    const root = (h.view() as unknown as { root: Group }).root;
    return { fire, left, right, root };
  }
  const worldOf = (o: Object3D) => o.getWorldPosition(new Vector3()).toArray();

  it('one hand: pinch and drag moves the model only, and the pinch does not select the part it started on', () => {
    const h = setup();
    const { fire, right, root } = withHands(h);
    const toolbar = worldOf(h.button(/^Explode$/)!);
    const battery = h.view().nodes.get('part:battery')!.mesh;
    const before = worldOf(battery);

    right.position.set(0.1, 1.2, -0.3);
    h.frames(2);
    clock += 300;
    fire('selectstart', 'right');
    pressStart(battery); // the ray was on a part
    h.frames(2);
    right.position.set(0.14, 1.2, -0.3); // past the 3 cm drag threshold: the drag starts here
    h.frames(2);
    right.position.set(0.24, 1.25, -0.3); // then 10 cm right, 5 cm up
    h.frames(30);
    fire('selectend', 'right');
    pressEnd(battery);
    h.frames(30);

    expect(root.position.x).toBeGreaterThan(0.05);
    expect(root.position.y).toBeGreaterThan(0.02);
    expect(worldOf(battery)[0]).toBeGreaterThan(before[0]! + 0.05);
    expect(worldOf(h.button(/^Explode$/)!)).toEqual(toolbar); // the toolbar stays put
    expect(h.state().selected_id).toBeNull();
    expectFinite(h.scene);
  });

  it('one hand: pinch and drag on empty space turns and tilts the model without moving it', () => {
    const h = setup();
    const { fire, right, root } = withHands(h);
    right.position.set(0.1, 1.2, -0.3);
    h.frames(2);
    clock += 300;
    fire('selectstart', 'right'); // the ray is on nothing: no press starts
    h.frames(2);
    right.position.set(0.14, 1.2, -0.3);
    h.frames(2);
    right.position.set(0.24, 1.26, -0.3); // 10 cm right, 6 cm up
    h.frames(30);
    fire('selectend', 'right');
    h.frames(30);
    expect(root.rotation.y).toBeGreaterThan(0.4);
    expect(root.rotation.x).toBeLessThan(-0.15);
    expect(root.position.length()).toBeLessThan(1e-6);
    expectFinite(h.scene);

    h.press(h.button(/^Recenter$/));
    h.frames(60);
    expect(root.rotation.y).toBeCloseTo(0, 3);
    expect(root.rotation.x).toBeCloseTo(0, 3);
  });

  it('the Gestures button shows a short guide that names every gesture, and hides it again', () => {
    const h = setup();
    const guide = () => h.panels().find((p) => /HAND GESTURES/.test(p.text));
    expect(guide()).toBeUndefined(); // not even drawn until asked for
    h.press(h.button(/^Gestures$/));
    const g = guide()!;
    expect(g.mesh.visible).toBe(true);
    for (const phrase of ['select a part', 'move the model', 'turn and tilt', 'explode, then zoom in', 'zoom out, then collapse', 'push away or pull closer', 'turn like a wheel', 'Recenter']) {
      expect(g.text).toContain(phrase);
    }
    expect(isInteractive(g.mesh)).toBe(false); // a card, not a control: it never blocks a ray press
    h.press(h.button(/^Hide gestures$/));
    expect(g.mesh.visible).toBe(false);
    expect(h.button(/^Gestures$/)).toBeDefined();
  });

  it('a pinch that starts on a toolbar button never drags the model, and still presses on release', () => {
    const h = setup();
    const { fire, right, root } = withHands(h);
    const explode = h.button(/^Explode$/)!;
    right.position.set(0.1, 1.2, -0.3);
    h.frames(2);
    clock += 300;
    fire('selectstart', 'right');
    pressStart(explode);
    h.frames(2);
    right.position.set(0.3, 1.2, -0.3);
    h.frames(10);
    fire('selectend', 'right');
    pressEnd(explode);
    h.frames(10);
    expect(root.position.x).toBe(0);
    expect(h.state().explode_factor).toBe(1);
  });

  it('two hands: pulling past fully exploded zooms in; Collapse returns it to full size', () => {
    const h = setup();
    const { fire, left, right, root } = withHands(h);
    left.position.set(-0.05, 1.2, -0.3);
    right.position.set(0.05, 1.2, -0.3);
    h.frames(2);
    fire('selectstart', 'left');
    fire('selectstart', 'right');
    h.frames(2);
    left.position.set(-0.25, 1.2, -0.3);
    right.position.set(0.25, 1.2, -0.3); // +40 cm: a full explode (25) and 15 more
    h.frames(40);
    expect(root.scale.x).toBeGreaterThan(1.5);
    fire('selectend', 'left');
    fire('selectend', 'right');
    h.frames(40);
    expect(h.state().explode_factor).toBe(1);
    expect(root.scale.x).toBeGreaterThan(1.5); // zoom stays after letting go
    expect(root.scale.y).toBe(root.scale.x);

    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(h.state().explode_factor).toBe(0);
    expect(root.scale.x).toBeCloseTo(1, 3);
    expectFinite(h.scene);
  });

  it('two hands: twisting turns the model, and Recenter puts everything back', () => {
    const h = setup();
    const { fire, left, right, root } = withHands(h);
    left.position.set(-0.15, 1.2, -0.3);
    right.position.set(0.15, 1.2, -0.3);
    h.frames(2);
    fire('selectstart', 'left');
    fire('selectstart', 'right');
    h.frames(2);
    left.position.set(-0.106, 1.2, -0.194); // 45° counter-clockwise from above, same distance apart
    right.position.set(0.106, 1.2, -0.406);
    h.frames(40);
    fire('selectend', 'left');
    fire('selectend', 'right');
    h.frames(10);
    expect(Math.abs(root.rotation.y)).toBeGreaterThan(0.4);

    h.press(h.button(/^Recenter$/));
    h.frames(60);
    expect(root.rotation.y).toBeCloseTo(0, 3);
    expect(root.position.length()).toBeLessThan(1e-3);
    expect(root.scale.x).toBeCloseTo(1, 3);
  });

  it('two hands: pushing them away tilts the model about the horizontal axis', () => {
    const h = setup();
    const { fire, left, right, root } = withHands(h);
    left.position.set(-0.15, 1.2, -0.3);
    right.position.set(0.15, 1.2, -0.3);
    h.frames(2);
    fire('selectstart', 'left');
    fire('selectstart', 'right');
    h.frames(2);
    left.position.set(-0.15, 1.2, -0.4); // both 10 cm further away
    right.position.set(0.15, 1.2, -0.4);
    h.frames(40);
    fire('selectend', 'left');
    fire('selectend', 'right');
    h.frames(10);
    expect(root.rotation.x).toBeLessThan(-0.5); // the top tips away
    expect(root.position.length()).toBeLessThan(1e-6);
    expect(Math.abs(root.rotation.y) + Math.abs(root.rotation.z)).toBeLessThan(0.02);
    expectFinite(h.scene);
  });

  it('two hands: turning them like a steering wheel rolls the model, and Recenter levels it', () => {
    const h = setup();
    const { fire, left, right, root } = withHands(h);
    left.position.set(-0.15, 1.2, -0.3);
    right.position.set(0.15, 1.2, -0.3);
    h.frames(2);
    fire('selectstart', 'left');
    fire('selectstart', 'right');
    h.frames(2);
    left.position.set(-0.106, 1.094, -0.3); // 45° counter-clockwise as the viewer sees it
    right.position.set(0.106, 1.306, -0.3);
    h.frames(40);
    fire('selectend', 'left');
    fire('selectend', 'right');
    h.frames(10);
    expect(root.rotation.order).toBe('ZXY'); // roll is about the line of sight, applied last
    expect(root.rotation.z).toBeGreaterThan(0.5);
    expect(Math.abs(root.rotation.y)).toBeLessThan(0.05);
    expectFinite(h.scene);

    h.press(h.button(/^Recenter$/));
    h.frames(60);
    expect(root.rotation.z).toBeCloseTo(0, 3);
  });

  it('the key equivalents move, zoom and turn the model', () => {
    const h = setup();
    h.press(h.button(/^Explode$/));
    const root = (h.view() as unknown as { root: Group }).root;
    const key = (k: string) => keyListeners.forEach((fn) => fn({ key: k }));
    key('=');
    key('ArrowRight');
    key('[');
    h.frames(60);
    expect(root.scale.x).toBeCloseTo(1.25, 2);
    expect(root.position.x).toBeCloseTo(0.05, 3);
    expect(root.rotation.y).toBeCloseTo(Math.PI / 12, 3);
  });
});

describe('scene harness: a press needs a real release', () => {
  it('in a session, a pinch whose ray slides off the part is not a press', () => {
    const h = setup();
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
    const fire = (type: string) => session.dispatchEvent({ type, inputSource: { handedness: 'right' } } as never);
    const battery = h.view().nodes.get('part:battery')!.mesh;

    clock += 300;
    fire('selectstart');
    pressStart(battery);
    h.frames(3);
    clock += 400;
    pressEnd(battery); // IWSDK dropped Pressed because the ray left; the pinch is still held
    h.frames(3);
    expect(h.state().selected_id).toBeNull();
    fire('selectend');
    h.frames(3);
    expect(h.state().selected_id).toBeNull();

    clock += 300;
    fire('selectstart');
    pressStart(battery);
    h.frames(3);
    fire('selectend');
    pressEnd(battery); // released on the part
    h.frames(3);
    expect(h.state().selected_id).toBe('part:battery');
  });
});

describe('scene harness: testing keys', () => {
  const key = (k: string) => keyListeners.forEach((fn) => fn({ key: k }));

  it('P logs world positions for every button, visible node and plug', () => {
    const h = setup();
    h.press(h.button(/^Explode$/));
    h.frames(90);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    key('p');
    const call = info.mock.calls.find((c) => c[0] === '[explode:targets]');
    expect(call, 'targets logged').toBeDefined();
    const t = JSON.parse(call![1] as string) as { step: string; buttons: Record<string, number[]>; nodes: Record<string, number[]>; plugs: Record<string, number[]> };
    expect(t.step).toMatch(/drivetrain-tutorial:1:active/);
    expect(Object.keys(t.buttons)).toEqual(expect.arrayContaining(['next', 'explode', 'trace', 'evidence', 'reset']));
    expect(t.nodes['part:motor']).toHaveLength(3);
    expect(t.plugs['edge:powers:part:inverter->part:motor']).toHaveLength(3);
    const explode = h.button(/^Collapse$/)!.getWorldPosition(new Vector3()).toArray();
    expect(t.buttons.explode).toEqual(explode);
  });

  it('0 forgets saved progress in both systems and returns to the start of the tutorial', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.step_index).toBe(1);
    key('0');
    h.frames(5);
    expect(h.state().system_id).toBe('system:ev-drivetrain');
    expect(h.state().lesson?.step_index).toBe(0);
    h.press(h.button(/Skip tutorial/));
    expect(h.state().lesson?.step_index).toBe(0); // the software log was forgotten too
  });
});

describe('scene harness: debug readout', () => {
  const readout = (h: ReturnType<typeof setup>) => h.panels().find((p) => /fps/.test(p.text));

  it('is absent by default and shows frame rate and draw calls with the debug flag', () => {
    const off = setup();
    off.frames(72);
    expect(readout(off)).toBeUndefined();

    const on = setup(true);
    on.frames(72);
    const r = readout(on)!;
    expect(r.mesh.visible).toBe(true);
    expect(r.text).toMatch(/72 fps/);
    expect(r.text).toMatch(/slow 0\//);
    expect(r.text).toMatch(/draws 123 +tris 4567/);
    expect(r.text).not.toMatch(/…/); // no line truncated to fit
    expect(TextPanel.clipEvents).toEqual([]);
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
    expect(evidenceText).toMatch(/src\/.*\.ts:\d+-\d+ @ tree [0-9a-f]{12}/);

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

  it('stays inside the draw-call budget and keeps every target at least 4 cm across to a ray', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    h.press(h.button(/^Trace/));
    h.press(h.button(/^Evidence$/));
    h.press(h.view().nodes.get('fn:src/sessions/store.ts#sessionstore.create')!.mesh); // predict
    const BREAK = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
    h.press(h.view().edges.get(BREAK)!.plug!.mesh);
    h.press(h.button(/^Next/)); // repair step: sockets shown, evidence open, path traced
    h.frames(30);
    expect(h.view().sockets).toHaveLength(3);

    // Every object the renderer would issue a draw call for: visible, with a visible material.
    let draws = 0;
    const walk = (o: Object3D) => {
      if (!o.visible) return;
      const m = o as Mesh & { isMesh?: boolean; material?: { visible?: boolean } };
      if (m.isMesh && m.material?.visible !== false) draws++;
      o.children.forEach(walk);
    };
    walk(h.scene);
    expect(draws).toBeGreaterThan(20);
    expect(draws, 'draw calls in the worst software scene').toBeLessThanOrEqual(120);

    for (const v of (h.view().nodes as Map<string, { node: { kind: string }; mesh: Mesh }>).values()) {
      if (v.node.kind !== 'cluster') expect(v.mesh.scale.x * 2, `ray target for ${v.node.kind}`).toBeGreaterThanOrEqual(0.04);
    }
    const plug = h.view().edges.get(BREAK)!.plug!.mesh as Mesh<SphereGeometry>;
    expect(plug.geometry.parameters.radius * 2).toBeGreaterThanOrEqual(0.04);
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
    h.press(h.button(/◂ Drivetrain/));
    h.frames(5);
    expect(h.entities.size).toBe(before);
  });
});

describe('scene harness: headset opening lesson', () => {
  const CAMERA_LINK = 'edge:transmits:part:cameras->part:board';
  type BackdropView = { mode: string; illustrated: boolean; targetOpacity: number };
  const backdrop = (h: ReturnType<typeof setup>) => (h.app as unknown as { backdrop: BackdropView }).backdrop;
  const mixedReality = (h: ReturnType<typeof setup>) => {
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'alpha-blend', inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
  };
  /** Explode → trace → unplug the camera link: the lesson is then at its prediction step. */
  const toPrediction = (h: ReturnType<typeof setup>) => {
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get(CAMERA_LINK)!.plug!.mesh);
    expect(h.state().broken_edge_ids).toEqual([CAMERA_LINK]);
  };

  it('opens on the headset model, and the drivetrain is one press away under More', () => {
    const h = setup(false, { bundles: shipped });
    expect(h.state().system_id).toBe('system:mr-headset');
    expect(h.caption()).toMatch(/headset like the one you're wearing/);
    expect(h.caption()).toMatch(/not the device's actual internals/);
    h.press(h.button(/^More: Drivetrain$/));
    expect(h.state().system_id).toBe('system:ev-drivetrain');
    h.press(h.button(/^More: Headset$/));
    expect(h.state().system_id).toBe('system:mr-headset');
    h.press(h.button(/Skip tutorial/));
    expect(h.state().system_id).toBe('system:auth-service');
    h.press(h.button(/◂ Headset/));
    expect(h.state().system_id).toBe('system:mr-headset');
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('runs the whole lesson in mixed reality: the room dims only once the prediction is in, and returns on repair', () => {
    const h = setup(false, { bundles: shipped });
    mixedReality(h);
    toPrediction(h);
    // Predicting: dimming now would give the answer away.
    expect(backdrop(h).illustrated).toBe(false);
    expect(h.caption()).not.toMatch(/We dimmed your view/);

    h.press(h.view().nodes.get('part:board')!.mesh);
    expect(h.state().prediction).toEqual({ target_id: 'part:board', correct: true });
    expect(backdrop(h).illustrated).toBe(true);
    expect(backdrop(h).targetOpacity).toBeGreaterThan(0.8);
    expect(backdrop(h).mode).toBe('passthrough'); // the viewer's own choice is untouched
    expect(h.caption()).toMatch(/We dimmed your view of the room/);
    expect(h.caption()).toMatch(/Your headset is fine/);

    h.press(h.button(/^Next/)); // observe → repair
    h.press(h.view().sockets.find((s) => s.targetId === 'part:board')!.mesh);
    expect(h.state().broken_edge_ids).toEqual([]);
    expect(backdrop(h).illustrated).toBe(false);
    expect(backdrop(h).targetOpacity).toBe(0);
    expect(h.caption()).not.toMatch(/We dimmed your view/);

    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(h.state().lesson?.status).toBe('complete');
    h.press(h.button(/Continue: software/));
    expect(h.state().system_id).toBe('system:auth-service');
    expectFinite(h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('never dims outside mixed reality: not on the 2D page, not over the virtual backdrop', () => {
    const page = setup(false, { bundles: shipped });
    toPrediction(page);
    page.press(page.view().nodes.get('part:board')!.mesh);
    expect(backdrop(page).illustrated).toBe(false);

    // Relaunch on the same saved progress (link cut, prediction made) inside an opaque session.
    const vr = setup(false, { bundles: shipped });
    (vr.xr as unknown as { session: unknown }).session = { environmentBlendMode: 'opaque', addEventListener: () => undefined };
    vr.world.session = (vr.xr as unknown as { session: unknown }).session;
    vr.xr.dispatchEvent({ type: 'sessionstart' });
    vr.frames(20);
    expect(vr.state().broken_edge_ids).toEqual([CAMERA_LINK]);
    expect(backdrop(vr).mode).toBe('virtual');
    expect(backdrop(vr).illustrated).toBe(false);
  });

  it('keeps the toolbar and the gesture card above the desk when the stage stands on one', () => {
    const DESK_Y = 0.74;
    const room = {
      planeCount: 1,
      onPlaneAdded: null,
      pickDesk: (_v: unknown, out: { x: number; y: number; z: number; index: number }) => {
        out.x = 0;
        out.y = DESK_Y;
        out.z = -0.3;
        out.index = 0;
        return true;
      },
    };
    const h = setup(false, { bundles: shipped, room });
    mixedReality(h);
    const ui = (h.app as unknown as { ui: { lowestPanelY(): number } }).ui;
    const app = h.app as unknown as { placedOn: string; anchor: Object3D };
    expect(app.placedOn).toBe('desk');
    h.press(h.button(/^Gestures$/));
    // lowestPanelY is in the anchor's frame; the anchor stands the stage on the desk.
    expect(app.anchor.position.y + ui.lowestPanelY()).toBeGreaterThan(DESK_Y);

    // Floating again (the desk is gone): the original layout comes back.
    room.pickDesk = () => false;
    h.press(h.button(/^Recenter$/));
    expect(app.placedOn).toBe('air');
    expect(ui.lowestPanelY()).toBeLessThan(-0.3);
  });
});

describe('scene harness: the desk spot is remembered across sessions', () => {
  const DESK = { x: 0.1, y: 0.74, z: -0.35 };
  const roomWithDesk = () => ({
    planeCount: 1,
    onPlaneAdded: null,
    pickDesk: (_v: unknown, out: { x: number; y: number; z: number; index: number }) => {
      out.x = DESK.x;
      out.y = DESK.y;
      out.z = DESK.z;
      out.index = 0;
      return true;
    },
  });
  /** A persistent anchor: `id` null until it is "restored"; `m` is its pose this session. */
  const anchor = (id: string | null) => {
    const a = { current: id, m: new Matrix4(), id: () => a.current, matrix: () => a.m };
    return a;
  };
  const enter = (h: ReturnType<typeof setup>) => {
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'alpha-blend', inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
  };
  const placed = (h: ReturnType<typeof setup>) => h.app as unknown as { placedOn: string; anchor: Object3D };

  it('saves the desk spot against the anchor and, next session, returns to it wherever the anchor now reports', () => {
    const a1 = anchor('anchor-1');
    const h = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: a1 });
    enter(h);
    expect(placed(h).placedOn).toBe('desk');
    const first = placed(h).anchor.position.clone();
    expect(localStorage.getItem('explode:desk:v1')).toContain('anchor-1');

    // Next session: the room picker would choose a different spot, and the reference space has
    // moved 0.5 m along x, so the same real anchor reports itself there.
    const a2 = anchor(null);
    a2.m.makeTranslation(0.5, 0, 0);
    const room = roomWithDesk();
    room.pickDesk = (_v, out) => {
      out.x = -0.4;
      out.y = 0.7;
      out.z = -0.2;
      out.index = 0;
      return true;
    };
    const h2 = setup(false, { bundles: shipped, room, anchors: a2 });
    enter(h2);
    expect(placed(h2).placedOn).toBe('desk'); // anchor not restored yet: the usual pick
    a2.current = 'anchor-1'; // the SDK restores the persistent anchor a moment later
    h2.frames(5);
    expect(placed(h2).placedOn).toBe('remembered');
    expect(placed(h2).anchor.position.x).toBeCloseTo(first.x + 0.5, 5);
    expect(placed(h2).anchor.position.y).toBeCloseTo(first.y, 5);
    expect(placed(h2).anchor.position.z).toBeCloseTo(first.z, 5);
  });

  it('a different anchor, a late anchor, or Recenter means a fresh pick', () => {
    const h = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: anchor('anchor-1') });
    enter(h);
    expect(localStorage.getItem('explode:desk:v1')).toContain('anchor-1');

    const other = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: anchor('anchor-2') });
    enter(other);
    other.frames(10);
    expect(placed(other).placedOn).toBe('desk'); // a new anchor: the old spot means nothing
    expect(localStorage.getItem('explode:desk:v1')).toContain('anchor-2'); // and the new one is remembered

    const late = anchor(null);
    const h3 = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: late });
    enter(h3);
    h3.frames(72 * 7); // past the recall window
    late.current = 'anchor-2';
    h3.frames(5);
    expect(placed(h3).placedOn).toBe('desk'); // too late to move the stage under the viewer

    const a4 = anchor('anchor-2');
    a4.m.makeTranslation(2, 0, 0);
    const h4 = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: a4 });
    enter(h4);
    expect(placed(h4).placedOn).toBe('remembered');
    h4.press(h4.button(/^Recenter$/));
    h4.frames(5);
    expect(placed(h4).placedOn).toBe('desk'); // the viewer's choice wins, and is remembered instead
  });

  it('never moves the stage outside mixed reality, and forgetting progress forgets the spot and leaves it', () => {
    const h = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: anchor('anchor-1') });
    enter(h);
    expect(localStorage.getItem('explode:desk:v1')).not.toBeNull();

    // Next session the stage is back on the remembered spot; the viewer is now elsewhere.
    const moved = anchor('anchor-1');
    moved.m.makeTranslation(1.5, 0, 0);
    const standing = roomWithDesk();
    standing.pickDesk = () => false;
    const h2 = setup(false, { bundles: shipped, room: standing, anchors: moved });
    enter(h2);
    expect(placed(h2).placedOn).toBe('remembered');
    keyListeners.at(-1)!({ key: '0' });
    h2.frames(5);
    expect(localStorage.getItem('explode:desk:v1')).toBeNull();
    expect(placed(h2).placedOn).toBe('air'); // placed afresh in front of the viewer

    const page = setup(false, { bundles: shipped, room: roomWithDesk(), anchors: anchor('anchor-1') });
    page.frames(20);
    expect(placed(page).placedOn).toBe('air'); // the 2D page has no desk
  });
});

describe('scene harness: sound follows the lesson', () => {
  it('each beat of the headset lesson has its sound, in order, placed where it happens', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const h = setup(false, { bundles: shipped });
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'alpha-blend', inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
    const sfx = (h.app as unknown as { sfx: { played: string[] } }).sfx;
    expect(sfx.played).toEqual([]); // nothing before the first press: no audio before a gesture

    // Only sounds that start are recorded; the hum stopping is not.
    let seen = 0;
    const since = () => {
      const out = sfx.played.slice(seen);
      seen = sfx.played.length;
      return out;
    };
    const LINK = 'edge:transmits:part:cameras->part:board';
    h.press(h.button(/^Explode$/));
    h.frames(60);
    expect(since()).toEqual(['explode', 'step']);
    h.press(h.button(/^Trace/));
    expect(since()).toEqual(['click', 'step', 'hum']); // the traced flow hums
    h.press(h.view().edges.get(LINK)!.plug!.mesh);
    expect(since()).toEqual(['unplug', 'step']); // the hum cuts out; no cascade before the prediction
    h.press(h.view().nodes.get('part:board')!.mesh);
    expect(since()).toEqual(['click', 'step', 'dim', 'cascade']);
    h.press(h.button(/^Next/));
    since();
    h.press(h.view().sockets.find((sk) => sk.targetId === 'part:display')!.mesh); // wrong socket
    expect(since()).toEqual(['reject']);
    h.press(h.view().sockets.find((sk) => sk.targetId === 'part:board')!.mesh);
    expect(since()).toEqual(['repair', 'step', 'undim', 'hum']);
    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(since()).toEqual(['collapse', 'complete']);

    // Placed sounds: the cascade's voices sit at the parts the failure reached.
    const ctx = FakeAudioContext.instances[0]!;
    const panned = ctx.nodes.filter((n) => n.kind === 'panner');
    expect(panned.length).toBeGreaterThan(5);
  });

  it('the Sound button cycles on, quiet and off', () => {
    const h = setup(false, { bundles: shipped });
    h.press(h.button(/^Sound: on$/));
    h.press(h.button(/^Sound: quiet$/));
    expect(h.button(/^Sound: off$/)).toBeDefined();
    expect(localStorage.getItem('explode:sound:v1')).toBe('off');
  });
});

describe('scene harness: finished lessons are remembered', () => {
  /** Run the headset lesson to the end on the 2D page. */
  const finishHeadset = (h: ReturnType<typeof setup>) => {
    const LINK = 'edge:transmits:part:cameras->part:board';
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get(LINK)!.plug!.mesh);
    h.press(h.view().nodes.get('part:board')!.mesh);
    h.press(h.button(/^Next/));
    h.press(h.view().sockets.find((sk) => sk.targetId === 'part:board')!.mesh);
    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(h.state().lesson?.status).toBe('complete');
  };

  it('a finished tutorial stays finished through Reset, and a replay says so', () => {
    const h = setup(false, { bundles: shipped });
    expect(h.button(/^Skip tutorial$/)).toBeDefined();
    finishHeadset(h);
    h.press(h.button(/^Reset$/));
    expect(h.state().lesson?.status).toBe('active'); // the lesson starts again...
    expect(h.button(/^Software ▸$/)).toBeDefined(); // ...but it is not a tutorial to skip any more
    expect(h.caption()).toMatch(/1\/7 · done before/);
  });

  it('More marks a finished lesson, and the reset key forgets every finished lesson', () => {
    const h = setup(false, { bundles: shipped });
    finishHeadset(h);
    h.press(h.button(/^More: Drivetrain$/)); // the drivetrain is not finished
    expect(h.button(/^More: Headset ✓$/)).toBeDefined();

    const again = setup(false, { bundles: shipped }); // relaunch: remembered
    expect(again.button(/^More: Headset ✓$/)).toBeDefined();
    keyListeners.at(-1)!({ key: '0' });
    again.frames(5);
    expect(again.state().system_id).toBe('system:mr-headset');
    expect(again.button(/^Skip tutorial$/)).toBeDefined();
    expect(again.button(/^More: Drivetrain$/)).toBeDefined();
    expect(TextPanel.clipEvents).toEqual([]);
  });
});

describe('scene harness: field-of-view layouts', () => {
  type Extent = { name: string; h: [number, number]; v: [number, number] };
  /** Angular extent of every visible panel in the UI, around the gaze from the eye to the model. */
  function extents(h: ReturnType<typeof setup>): Extent[] {
    const ui = (h.app as unknown as { ui: { group: Object3D } }).ui.group;
    const anchor = (h.app as unknown as { anchor: Object3D }).anchor;
    h.scene.updateMatrixWorld(true);
    const eye = h.camera.getWorldPosition(new Vector3());
    // The view frustum of a viewer looking at the model: rotate into the gaze, then tangent angles.
    const g = anchor.getWorldPosition(new Vector3()).sub(eye);
    const toGaze = new Quaternion().setFromEuler(new Euler(Math.asin(g.y / g.length()), -Math.atan2(g.x, -g.z), 0, 'YXZ')).invert();
    const out: Extent[] = [];
    ui.traverse((o) => {
      const m = o as Mesh & { geometry?: { parameters?: { width: number; height: number } } };
      const p = m.geometry?.parameters;
      if (!p?.width) return;
      for (let a: Object3D | null = o; a; a = a.parent) if (!a.visible) return;
      if (o.getWorldScale(new Vector3()).x < 0.01) return; // a hidden button, shrunk out of reach
      const e: Extent = { name: (canvasText.get((m.material as unknown as { map: { image: object } }).map.image) ?? []).join(' ').slice(0, 24), h: [99, -99], v: [99, -99] };
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const c = new Vector3((sx * p.width) / 2, (sy * p.height) / 2, 0).applyMatrix4(o.matrixWorld).sub(eye).applyQuaternion(toGaze);
        const hh = MathUtils.radToDeg(Math.atan2(c.x, -c.z));
        const vv = MathUtils.radToDeg(Math.atan2(c.y, -c.z));
        e.h = [Math.min(e.h[0], hh), Math.max(e.h[1], hh)];
        e.v = [Math.min(e.v[0], vv), Math.max(e.v[1], vv)];
      }
      out.push(e);
    });
    return out;
  }

  const DESK_Y = 0.74;
  function scene(layout: 'wide' | 'narrow', onDesk: boolean) {
    localStorage.setItem('explode:layout:v1', layout);
    const room = {
      planeCount: 1,
      onPlaneAdded: null,
      pickDesk: (_v: unknown, o: { x: number; y: number; z: number; index: number }) => {
        o.x = 0;
        o.y = DESK_Y;
        o.z = -0.15;
        o.index = 0;
        return onDesk;
      },
    };
    const h = setup(false, { bundles: shipped, room });
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'alpha-blend', inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
    expect((h.app as unknown as { placedOn: string }).placedOn).toBe(onDesk ? 'desk' : 'air');
    return h;
  }

  /** The software lesson's busiest moment: exploded, traced, evidence open, gesture card shown. */
  function busiest(h: ReturnType<typeof setup>) {
    h.press(h.button(/^Next/)); // headset intro is an explode step; go straight to software via keys
    keyListeners.at(-1)!({ key: 's' });
    h.frames(5);
    keyListeners.at(-1)!({ key: 'n' });
    keyListeners.at(-1)!({ key: 'e' });
    h.frames(60);
    keyListeners.at(-1)!({ key: 't' });
    h.press(h.button(/^Evidence$/));
    keyListeners.at(-1)!({ key: 'g' });
    h.frames(20);
    expect((h.app as unknown as { ui: { guideVisible: boolean } }).ui.guideVisible).toBe(true);
  }

  for (const onDesk of [false, true]) {
    const where = onDesk ? 'on a desk' : 'floating';
    it(`narrow, ${where}: every panel, evidence and gestures included, fits the glasses-class budget`, () => {
      const h = scene('narrow', onDesk);
      busiest(h);
      const b = FOV_BUDGET.narrow;
      const all = extents(h);
      const check = (list: Extent[]) => {
        for (const e of list) {
          expect(Math.max(-e.h[0], e.h[1]), `${e.name}: horizontal`).toBeLessThanOrEqual(b.h);
          expect(Math.max(-e.v[0], e.v[1]), `${e.name}: vertical`).toBeLessThanOrEqual(b.v);
        }
        // No two panels may overlap: an overlap hides text and puts two targets in one place.
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const [p, q] = [list[i]!, list[j]!];
            const overlap = Math.min(p.h[1], q.h[1]) - Math.max(p.h[0], q.h[0]) > 0.5 && Math.min(p.v[1], q.v[1]) - Math.max(p.v[0], q.v[0]) > 0.5;
            expect(overlap, `${p.name} ${JSON.stringify([p.h, p.v].map((r) => r.map(Math.round)))} overlaps ${q.name} ${JSON.stringify([q.h, q.v].map((r) => r.map(Math.round)))}`).toBe(false);
          }
      };
      // The gesture card is shown: it takes the evidence panel's place.
      expect(all.some((e) => /^HAND GESTURES/.test(e.name))).toBe(true);
      expect(all.some((e) => /^EVIDENCE/.test(e.name))).toBe(false);
      check(all);
      // Hide it, and the evidence panel is back, also inside the budget and clear of everything.
      keyListeners.at(-1)!({ key: 'g' });
      h.frames(20);
      const withEvidence = extents(h);
      expect(withEvidence.some((e) => /^EVIDENCE/.test(e.name))).toBe(true);
      check(withEvidence);
      // Only the lesson's buttons are shown, and a hidden one cannot be pressed.
      expect(h.button(/^Live AI/)).toBeUndefined();
      expect(TextPanel.clipEvents).toEqual([]);
    });

    it(`wide, ${where}: caption and toolbar fit the Quest 3S budget; nothing sits under the desk`, () => {
      const h = scene('wide', onDesk);
      busiest(h);
      const b = FOV_BUDGET.wide;
      for (const e of extents(h).filter((x) => !/^EVIDENCE|^HAND GESTURES|^Close/.test(x.name))) {
        expect(Math.max(-e.h[0], e.h[1]), `${e.name}: horizontal`).toBeLessThanOrEqual(b.h);
        expect(Math.max(-e.v[0], e.v[1]), `${e.name}: vertical`).toBeLessThanOrEqual(b.v);
      }
      if (onDesk) {
        const ui = (h.app as unknown as { ui: { lowestPanelY(): number } }).ui;
        const anchor = (h.app as unknown as { anchor: Object3D }).anchor;
        expect(anchor.position.y + ui.lowestPanelY()).toBeGreaterThan(DESK_Y);
      }
    });
  }

  it('the Layout button switches layouts, and the choice is remembered', () => {
    const h = setup(false, { bundles: shipped });
    h.press(h.button(/^Layout: wide$/));
    expect(localStorage.getItem('explode:layout:v1')).toBe('narrow');
    expect(h.button(/^Layout: narrow$/)).toBeDefined();
    expect(h.button(/^Skip tutorial$/)).toBeUndefined(); // not a lesson button: hidden in narrow
    const again = setup(false, { bundles: shipped });
    expect(again.button(/^Layout: narrow$/)).toBeDefined();
    again.press(again.button(/^Layout: narrow$/));
    expect(again.button(/^Skip tutorial$/)).toBeDefined();
  });
});

describe('scene harness: part labels never overlap', () => {
  /** View-tangent rectangles of every visible part label (15 × 3 cm panels under the model root). */
  function labelRects(h: ReturnType<typeof setup>): Array<{ text: string; r: [number, number, number, number] }> {
    h.scene.updateMatrixWorld(true);
    const root = (h.view() as unknown as { root: Object3D }).root;
    const out: Array<{ text: string; r: [number, number, number, number] }> = [];
    root.traverse((o) => {
      const m = o as Mesh & { geometry?: { parameters?: { width: number; height: number } } };
      const g = m.geometry?.parameters;
      if (!g || Math.abs(g.width - 0.15) > 1e-6 || Math.abs(g.height - 0.03) > 1e-6) return;
      const img = (m.material as unknown as { map?: { image?: object } | null }).map?.image;
      if (!img || !canvasText.has(img)) return; // a label is a text panel
      for (let a: Object3D | null = o; a; a = a.parent) if (!a.visible) return;
      const c = o.getWorldPosition(new Vector3()).applyMatrix4(h.camera.matrixWorldInverse);
      const d = -c.z;
      const s = o.getWorldScale(new Vector3()).x;
      const hw = (0.075 * s) / d;
      const hh = (0.015 * s) / d;
      out.push({ text: (canvasText.get(img) ?? []).join(' '), r: [c.x / d - hw, c.y / d - hh, c.x / d + hw, c.y / d + hh] });
    });
    return out;
  }
  function expectNoOverlap(list: ReturnType<typeof labelRects>) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i]!.r, list[j]!.r];
        const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-4;
        expect(overlap, `"${list[i]!.text}" overlaps "${list[j]!.text}"`).toBe(false);
      }
  }

  it('the exploded codebase, traced and broken, shows its labels without overlap', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    h.press(h.button(/^Trace/));
    h.frames(10);
    let labels = labelRects(h);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    expectNoOverlap(labels);
    h.press(h.button(/^Evidence$/));
    h.press(h.view().nodes.get('fn:src/sessions/store.ts#sessionstore.create')!.mesh); // predict
    const BREAK = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
    h.press(h.view().edges.get(BREAK)!.plug!.mesh);
    h.frames(30);
    labels = labelRects(h);
    expect(labels.some((l) => /stopped/.test(l.text))).toBe(true); // the failure's labels win their place
    expectNoOverlap(labels);
  });

  it('the headset and the drivetrain, exploded, show every part label without overlap', () => {
    const h = setup(false, { bundles: shipped });
    h.press(h.button(/^Explode$/));
    h.frames(90);
    const headset = labelRects(h);
    expect(headset.length).toBeGreaterThanOrEqual(7);
    expectNoOverlap(headset);
    h.press(h.button(/^More: Drivetrain$/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    const car = labelRects(h);
    expect(car.length).toBeGreaterThanOrEqual(6);
    expectNoOverlap(car);
  });
});
