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
import jupiterJson from '../src/content/jupiter.bundle.json';
import repoJson from '../src/content/repo-demo.bundle.json';
import sdkJson from '../src/content/iwsdk.bundle.json';
import { startApp, type ExplodeApp, type ExplodeDeps } from '../src/app/app.ts';
import { ExplodeError, type ExplodeApi } from '../src/app/explode-client.ts';
import { MemorySavedSystems } from '../src/app/saved-systems.ts';
import type { ExplodeJob, ExplodeProposal, RepositoryProposal, SubjectProposal } from '@explode/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFromCuration, buildSubjectBundle, indexAnyRepo } from '../../../tools/content/src/index.ts';
import { DRAFT, META } from '../../../tools/content/test/subject-fixture.ts';
import { FIXTURE_ANSWER, FIXTURE_FILES, FIXTURE_SOURCE, writeFixture } from '../../../tools/content/test/any-repo-fixture.ts';
import { firePress, isInteractive, pressEnd, pressStart } from '../src/app/interactions.ts';
import { TextPanel } from '../src/app/text.ts';
import { foldOf } from '../src/app/ui.ts';
import { FakeAudioContext } from './fake-audio.ts';
import { FOV_BUDGET } from '../src/app/fov.ts';
import { hasLook } from '../src/app/looks/registry.ts';
import { PROJECTS, type LoadProgress, type Project } from '../src/app/projects.ts';

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

function setup(debug = false, opts: { bundles?: ContentBundle[]; room?: unknown; anchors?: unknown; tutorUrl?: string; projects?: Project[]; explode?: ExplodeDeps } = {}) {
  const w = makeWorld();
  const app = startApp(w.world as never, opts.bundles ?? bundles, opts.tutorUrl ?? null, debug, (opts.room ?? null) as never, (opts.anchors ?? null) as never, opts.projects, opts.explode ?? null);
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
  const shown = (label: RegExp) => panels().find((p) => isInteractive(p.mesh) && p.mesh.visible && label.test(p.text))?.mesh;
  /** A button as a person finds it: on screen, or behind the wide layout's Options or Move fold, which this opens. */
  const button = (label: RegExp) => {
    const now = shown(label);
    if (now) return now;
    // Only a button that exists, folded away, is worth opening a fold for (pressing advances the clock).
    // A folded button is not drawn, so find it among the app's button definitions, and its fold.
    const defs = (app as unknown as { buttonDefs: Array<{ id: string; label: () => string }> }).buttonDefs;
    const fold = defs.map((d) => (label.test(d.label()) ? foldOf(d.id) : null)).find((f) => f !== null);
    const toggle = fold ? shown(fold === 'options' ? /^Options ▾$/ : /^Move ▾$/) : undefined;
    if (!toggle) return undefined;
    press(toggle);
    return shown(label);
  };
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
    right.position.set(0.13, 1.23, -0.3); // sets off diagonally: spin and tilt are both free
    h.frames(2);
    right.position.set(0.23, 1.29, -0.3); // 10 cm right, 6 cm up
    h.frames(30);
    clock += 500; // held before letting go, as a deliberate turn is (a quick release would be a flick)
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
    for (const phrase of ['select a part', 'move the model', 'sideways  →  spin it', 'up or down  →  tilt it', 'one forward, one back', 'explode, then zoom in', 'zoom out, then collapse', 'push away or pull closer', 'turn like a wheel', 'Recenter']) {
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
    expect(h.caption()).toMatch(/written as a sample for Explode Anything/);

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

  it('a live answer names the model it came from (EXPLORE_PLAN W12)', () => {
    const h = setup(false, { tutorUrl: 'https://proxy.example' });
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    const login = 'fn:src/auth/service.ts#authservice.login';
    h.press(h.view().nodes.get(login)!.mesh);
    const node = ContentBundle.parse(repoJson).graph.nodes.find((n) => n.id === login)!;
    const plan = { say: 'AuthService.login checks the password, then creates a session.', claim_status: 'static_verified', evidence_ids: [node.evidence_ids[0]], actions: [], abstain: false };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan, source: 'live', model: 'muse-ember-1.0' }), { status: 200 })));
    h.press(h.button(/Explain this/));
    return vi.waitFor(() => {
      h.frames(5);
      expect(h.caption()).toMatch(/Tutor \(live AI · muse-ember-1\.0\)/);
      expect(h.caption()).toMatch(/checks the password/);
    });
  });

  it('a typed question can act for the learner: it presses, traces and unplugs through the same handlers', async () => {
    const h = setup(false, { tutorUrl: 'https://proxy.example' });
    h.press(h.button(/Skip tutorial/));
    const graph = ContentBundle.parse(repoJson).graph;
    const edge = graph.edges.find((e) => e.is_mutable_in_sandbox)!;
    const plan = {
      say: 'Opening it up and tracing the request.',
      claim_status: 'unknown',
      evidence_ids: [],
      actions: [],
      commands: [{ type: 'press', button_id: 'explode' }, { type: 'trace', path_id: graph.paths[0]!.id }, { type: 'unplug', edge_id: edge.id }],
      abstain: false,
    };
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ plan, source: 'live', model: 'muse-ember-1.0' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const answer = await h.app.ask('open it up, trace the login and cut that link');
    h.frames(60);
    expect(answer?.source).toBe('live');
    expect(h.state().explode_factor).toBe(1);
    expect(h.state().active_path_id).toBe(graph.paths[0]!.id);
    expect(h.state().broken_edge_ids).toEqual([edge.id]);
    expect(h.caption()).toMatch(/Opening it up/); // still shown although the lesson moved on
    // The request says what is on screen, and the second question carries the conversation.
    const first = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(first.trigger).toBe('free_text');
    expect(first.view.buttons.find((b: { id: string }) => b.id === 'explode')).toMatchObject({ label: 'Explode', enabled: true });
    expect(first.view.systems.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    await h.app.ask('and now?');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).history).toHaveLength(2);
  });

  it('the assistant icon is shown only with a live tutor, and says so when there is no microphone', async () => {
    expect(setup().button(/^Ask$/)).toBeUndefined();
    const h = setup(false, { tutorUrl: 'https://proxy.example' });
    const ask = h.button(/^Ask$/);
    expect(ask).toBeDefined();
    h.press(ask); // this environment has no microphone API
    await vi.waitFor(() => {
      h.frames(10);
      expect(h.caption()).toMatch(/gave me no microphone/);
    });
    expect(h.button(/^Ask$/)).toBeDefined(); // back to idle
  });

  it('a spoken question is transcribed, answered and acted on, and what was heard is shown', async () => {
    const h = setup(false, { tutorUrl: 'https://proxy.example' });
    h.press(h.button(/Skip tutorial/));
    const voice = (h.app as unknown as { voice: { listen: () => Promise<unknown> } }).voice;
    voice.listen = async () => ({ kind: 'audio', wav: new Blob([new Uint8Array(100)], { type: 'audio/wav' }) });
    const plan = { say: 'Opening it up.', claim_status: 'unknown', evidence_ids: [], actions: [], commands: [{ type: 'press', button_id: 'explode' }], abstain: false };
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) =>
      new Response(JSON.stringify(url.endsWith('/transcribe') ? { text: 'explode it' } : { plan, source: 'live', model: 'm' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    h.press(h.button(/^Ask$/));
    await vi.waitFor(() => {
      h.frames(10);
      expect(h.caption()).toMatch(/Heard: "explode it"/);
    });
    expect(h.state().explode_factor).toBe(1);
    expect(h.caption()).toMatch(/Opening it up/);
    expect(fetchMock.mock.calls.map((c) => c[0].split('/').pop())).toEqual(['transcribe', 'turn']);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).free_text).toBe('explode it');
  });

  it('a chip answer that tries to act is refused, and nothing happens', () => {
    const h = setup(false, { tutorUrl: 'https://proxy.example' });
    h.press(h.button(/Skip tutorial/));
    const plan = { say: 'Exploding.', claim_status: 'unknown', evidence_ids: [], actions: [], commands: [{ type: 'set_explode', factor: 1 }], abstain: false };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan, source: 'live', model: 'm' }), { status: 200 })));
    h.press(h.button(/^Hint$/));
    return vi.waitFor(() => {
      h.frames(5);
      expect(h.caption()).toMatch(/failed validation/);
      expect(h.state().explode_factor).toBe(0);
    });
  });

  it('keeps the exploded layout inside the 60°×50° cone and labels capped at 30', () => {
    localStorage.setItem('explode:detail:v1', 'all'); // the worst case: every part shown
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
      if (!v.mesh.visible) continue; // put away on the shelf by the detail level
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
    localStorage.setItem('explode:detail:v1', 'all'); // the worst case: every part shown
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
      if (v.node.kind !== 'cluster' && v.mesh.visible) expect(v.mesh.scale.x * 2, `ray target for ${v.node.kind}`).toBeGreaterThanOrEqual(0.04);
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
    // The camera link carries data: the caption must not say the board stops receiving power.
    expect(h.caption()).toMatch(/stop receiving data in this teaching model/);
    expect(h.caption()).not.toMatch(/power/);

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

  it('says why the stage floats in mixed reality, and how to stand it on the desk, until the first action', () => {
    const room = (planeCount: number) => ({ planeCount, onPlaneAdded: null, pickDesk: () => false, describe: () => [] });
    const none = setup(false, { bundles: shipped, room: room(0) });
    expect(none.caption()).not.toMatch(/floats/); // not on the 2D page
    mixedReality(none);
    expect(none.caption()).toMatch(/No room setup was found, so the model floats/);
    expect(none.caption()).toMatch(/Space Setup/);
    none.press(none.button(/^Explode$/));
    expect(none.caption()).not.toMatch(/floats/);

    const standing = setup(false, { bundles: shipped, room: room(12) });
    mixedReality(standing);
    expect(standing.caption()).toMatch(/No table within reach/);

    const vr = setup(false, { bundles: shipped, room: room(0) });
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'opaque', inputSources: [{}, {}] as unknown[] });
    (vr.xr as unknown as { session: unknown }).session = session;
    vr.world.session = session;
    vr.xr.dispatchEvent({ type: 'sessionstart' });
    vr.frames(20);
    expect(vr.caption()).not.toMatch(/floats/); // a virtual backdrop has no room to stand on
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
    h.frames(30); // the headset leaves the stage first
    keyListeners.at(-1)!({ key: 'n' });
    keyListeners.at(-1)!({ key: 'e' });
    h.frames(60);
    keyListeners.at(-1)!({ key: 't' });
    h.press(h.button(/^Evidence$/));
    keyListeners.at(-1)!({ key: 'g' });
    h.frames(20);
    expect((h.app as unknown as { ui: { guideVisible: boolean } }).ui.guideVisible).toBe(true);
  }

  it('wide: no toolbar button stands in front of the open model, the settings strip is above the caption, and no part label lies across it', () => {
    const h = scene('wide', false);
    busiest(h);
    const all = extents(h);
    // How far left the open model reaches, in the same view angles: every shown part, out to its ray target's edge.
    const anchor = (h.app as unknown as { anchor: Object3D }).anchor;
    const eye = h.camera.getWorldPosition(new Vector3());
    const g = anchor.getWorldPosition(new Vector3()).sub(eye);
    const toGaze = new Quaternion().setFromEuler(new Euler(Math.asin(g.y / g.length()), -Math.atan2(g.x, -g.z), 0, 'YXZ')).invert();
    let modelLeft = 0;
    const nodes = h.view().nodes as unknown as Map<string, { mesh: Mesh; label: { mesh: Mesh } | null }>;
    for (const v of nodes.values()) {
      if (!v.mesh.visible || v.mesh.scale.x < 0.001) continue;
      const c = v.mesh.getWorldPosition(new Vector3()).sub(eye).applyQuaternion(toGaze);
      modelLeft = Math.min(modelLeft, MathUtils.radToDeg(Math.atan2(c.x - v.mesh.scale.x, -c.z)));
    }
    expect(modelLeft).toBeLessThan(-20); // the model is open and wide

    // Explain this and What depends are asked from the part's own menu (ui.ts MENU_ONLY).
    const lessonButtons = all.filter((e) => /^(Next|Lesson done|Incident|Collapse|Explode|Trace|Detail|Evidence$|Explain this|What depends|Why it failed|Hint|Undo)/.test(e.name));
    expect(lessonButtons.map((e) => e.name.split(' ')[0])).toEqual(['Next', 'Collapse', 'Trace', 'Detail:', 'Evidence', 'Why', 'Hint', 'Undo']);
    for (const e of lessonButtons) expect(e.h[1], `${e.name} is left of the model`).toBeLessThanOrEqual(modelLeft);

    const caption = all.find((e) => /^What happens when/.test(e.name))!; // the lesson's title heads the caption panel
    const SETTINGS = /^(Reset|Recenter|Gestures|Hide gestures|Sound|Layout|View|◂|More|Projects|Live AI|Options)/;
    // Folded: Recenter, the way back to the tutorial, and Options.
    const folded = all.filter((e) => SETTINGS.test(e.name));
    expect(folded.map((e) => e.name.split(' ')[0])).toEqual(['Recenter', '◂', 'Options']);
    for (const e of folded) expect(e.v[0], `${e.name} is above the caption`).toBeGreaterThanOrEqual(caption.v[1]);
    // Open: all eleven, still above the caption: the strip grows upward.
    h.press(h.button(/^Options ▾$/));
    const open = extents(h).filter((e) => SETTINGS.test(e.name));
    expect(open).toHaveLength(11);
    for (const e of open) expect(e.v[0], `${e.name} is above the caption`).toBeGreaterThanOrEqual(caption.v[1]);
    // The view dock is folded to its Move toggle until asked for.
    expect(all.filter((e) => /^(Spread|Turn|Tilt|Raise|Lower|Zoom|Home view)/.test(e.name))).toHaveLength(0);
    expect(all.some((e) => /^Move ▾$/.test(e.name))).toBe(true);

    // The caption panel's lower edge is 0.24 m above the model's centre (ui.ts): every part label stays under it.
    let labels = 0;
    for (const v of nodes.values()) {
      if (!v.label?.mesh.visible) continue;
      labels++;
      expect(v.label.mesh.position.y + 0.015, 'label top').toBeLessThanOrEqual(0.24);
    }
    expect(labels).toBeGreaterThan(5);
  });

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

    it(`wide, ${where}: caption and toolbar fit the Quest 3S budget, with both folds open; nothing sits under the desk`, () => {
      const h = scene('wide', onDesk);
      busiest(h);
      h.press(h.button(/^Options ▾$/));
      h.press(h.button(/^Move ▾$/));
      expect(h.button(/^Home view$/)).toBeDefined();
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
    localStorage.setItem('explode:detail:v1', 'all'); // the worst case: every part shown
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

  it('Jupiter, exploded, shows every part label without overlap', () => {
    const h = setup(false, { bundles: [ContentBundle.parse(jupiterJson), ContentBundle.parse(repoJson)] });
    h.press(h.button(/^Explode$/));
    h.frames(90);
    const planet = labelRects(h);
    expect(planet.length).toBe(9);
    expectNoOverlap(planet);
  });
});

describe('scene harness: render budget for the opening scene', () => {
  it('the headset on a desk, exploded, cut and dimmed, with the gesture card open, stays inside the draw-call budget', () => {
    const room = {
      planeCount: 1,
      onPlaneAdded: null,
      pickDesk: (_v: unknown, o: { x: number; y: number; z: number; index: number }) => {
        o.x = 0;
        o.y = 0.74;
        o.z = -0.15;
        o.index = 0;
        return true;
      },
    };
    const h = setup(false, { bundles: shipped, room });
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { environmentBlendMode: 'alpha-blend', inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
    expect((h.app as unknown as { placedOn: string }).placedOn).toBe('desk');
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get('edge:transmits:part:cameras->part:board')!.plug!.mesh);
    h.press(h.view().nodes.get('part:board')!.mesh); // prediction in: the room dims, the failure shows
    h.press(h.button(/^Gestures$/));
    h.frames(60);
    expect((h.app as unknown as { backdrop: { illustrated: boolean } }).backdrop.illustrated).toBe(true);

    let draws = 0;
    const walk = (o: Object3D) => {
      if (!o.visible) return;
      const m = o as Mesh & { isMesh?: boolean; isLine?: boolean; material?: { visible?: boolean } };
      if ((m.isMesh || m.isLine) && m.material?.visible !== false) draws++;
      o.children.forEach(walk);
    };
    walk(h.scene);
    expect(draws).toBeGreaterThan(20);
    expect(draws, 'draw calls in the opening scene at its busiest').toBeLessThanOrEqual(120); // 50 measured on Nov 11
  });
});

describe('scene harness: the incident drill', () => {
  const DRILL_EDGE = 'edge:handles:fn:src/http/middleware.ts#ratelimit->fn:src/http/middleware.ts#parsejsonbody';
  const FIRST_STOPPED = 'fn:src/http/middleware.ts#parsejsonbody';
  /** Finish the codebase lesson by in-world presses (as the hero lesson test does). */
  function finishLesson(h: ReturnType<typeof setup>) {
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    h.press(h.button(/^Evidence$/));
    h.press(h.view().nodes.get('fn:src/sessions/store.ts#sessionstore.create')!.mesh);
    const BREAK = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
    h.press(h.view().edges.get(BREAK)!.plug!.mesh);
    h.press(h.button(/^Next/));
    h.press(h.view().sockets.find((s) => s.targetId === 'fn:src/sessions/store.ts#sessionstore.create')!.mesh);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');
  }

  it('follows the lesson, starts broken, hides what the cut stops until the diagnosis, and is solved by repair', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const h = setup();
    finishLesson(h);
    expect(h.caption()).toMatch(/Ready for an incident/);
    h.press(h.button(/^Incident drill ▸$/));
    expect(h.state().lesson?.lesson_id).toBe('lesson:repo-incident');
    expect(h.state().broken_edge_ids).toEqual([DRILL_EDGE]);
    expect(h.caption()).toMatch(/Incident: .*2 of 10 tests failed/);
    expect(h.caption()).not.toMatch(/parseJsonBody/); // the symptom does not name the cut

    // Before the diagnosis: no "stopped" labels, no consequence text, no cascade.
    const sfx = (h.app as unknown as { sfx: { played: string[] } }).sfx;
    sfx.played.length = 0; // the lesson's own cascade is earlier in the (capped) log
    const sinceDrill = () => sfx.played;
    const stoppedLabels = () => h.panels().filter((p) => /· stopped/.test(p.text) && p.mesh.visible).length;
    h.press(h.button(/^Next/));
    expect(h.caption()).not.toMatch(/done before/); // the lesson was finished, the drill was not
    h.press(h.button(/^Explode$/)); // a fresh start: the model begins collapsed
    h.frames(60);
    expect(h.caption()).toMatch(/Find the cut/);
    expect(stoppedLabels()).toBe(0);
    expect(h.caption()).not.toMatch(/OBSERVED|HYPOTHESIS/);
    expect(sinceDrill()).not.toContain('cascade');

    h.press(h.view().nodes.get(FIRST_STOPPED)!.mesh);
    expect(h.state().prediction).toEqual({ target_id: FIRST_STOPPED, correct: true });
    h.frames(10);
    expect(stoppedLabels()).toBeGreaterThan(0); // now the failure shows
    expect(h.caption()).toMatch(/OBSERVED/);
    expect(sinceDrill()).toContain('cascade');
    expect(h.state().evidence_open_id).toBe('ev:run:mut:drop-body-parser');

    h.press(h.button(/^Next/));
    const sockets = h.view().sockets;
    expect(sockets).toHaveLength(3);
    h.press(sockets.find((s) => s.targetId === FIRST_STOPPED)!.mesh);
    expect(h.state().broken_edge_ids).toEqual([]);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');
    expect(h.button(/^Lesson done$/)).toBeDefined(); // the drill is the last lesson
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('Reset brings the incident back, and a relaunch restores the drill where it was', () => {
    const h = setup();
    finishLesson(h);
    h.press(h.button(/^Incident drill ▸$/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Reset$/));
    expect(h.state().lesson).toEqual({ lesson_id: 'lesson:repo-incident', step_index: 0, status: 'active' });
    expect(h.state().broken_edge_ids).toEqual([DRILL_EDGE]);
    h.press(h.button(/^Next/));
    const before = h.state();
    const again = setup(); // same storage: a relaunch
    expect(again.state()).toEqual(before);
  });
});

describe('scene harness: detail levels for the codebase (EXPLORE_PLAN W11)', () => {
  const BREAK = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
  const EXTRA = 'fn:src/routes/login.ts#readcredentials'; // a leaf function off the login path
  const REVOKE = 'fn:src/sessions/store.ts#sessionstore.revoke'; // an extra that is also a wrong socket
  const shown = (h: ReturnType<typeof setup>) => [...h.view().nodes.values()].filter((v) => v.mesh.visible).length;
  const shelf = (h: ReturnType<typeof setup>) => h.panels().find((p) => /hidden · Show/.test(p.text) && p.mesh.visible);
  /** A hand-tracked session, as the "handling the model" tests use. */
  function withHands(h: ReturnType<typeof setup>) {
    const session = Object.assign(new EventDispatcher<Record<string, { inputSource: { handedness: string } }>>(), { inputSources: [{}, {}] as unknown[] });
    (h.xr as unknown as { session: unknown }).session = session;
    h.world.session = session;
    h.xr.dispatchEvent({ type: 'sessionstart' });
    h.frames(20);
    const fire = (type: string, handedness: string) => session.dispatchEvent({ type, inputSource: { handedness } } as never);
    return { fire, right: h.world.player.gripSpaces.right };
  }
  function openCodebase(h: ReturnType<typeof setup>) {
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
  }

  it('opens on key and supporting parts, the extras on a shelf that cannot be pressed through', () => {
    const h = setup();
    openCodebase(h);
    expect(h.button(/^Detail: more$/)).toBeDefined();
    expect(shown(h)).toBe(44);
    expect(shelf(h)?.text).toMatch(/\+23 hidden · Show/);
    const extra = h.view().nodes.get(EXTRA)!.mesh;
    expect(extra.visible).toBe(false);
    expect(extra.scale.x, 'a shelved part takes no ray hits').toBeLessThan(0.001);
    h.press(extra);
    expect(h.state().selected_id).toBeNull();
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('the Detail button cycles more → all → key, the shelf shows one level more, and the choice is remembered', () => {
    const h = setup();
    openCodebase(h);
    h.press(h.button(/^Detail: more$/));
    h.frames(60);
    expect(shown(h)).toBe(67);
    expect(shelf(h)).toBeUndefined();
    expect(h.view().nodes.get(EXTRA)!.mesh.visible).toBe(true);
    h.press(h.button(/^Detail: all$/));
    h.frames(60);
    expect(shown(h)).toBe(19);
    expect(shelf(h)?.text).toMatch(/\+48 hidden/);
    h.press(shelf(h)!.mesh);
    h.frames(60);
    expect(h.button(/^Detail: more$/)).toBeDefined();
    expect(shown(h)).toBe(44);
    const again = setup(); // same storage: a relaunch
    expect(again.button(/^Detail: more$/)).toBeDefined();
    again.press(again.button(/^Detail: more$/));
    expect(setup().button(/^Detail: all$/)).toBeDefined();
  });

  it('at the key level the whole lesson and the drill still work: every part they need is shown', () => {
    localStorage.setItem('explode:detail:v1', 'key');
    const h = setup();
    openCodebase(h);
    expect(shown(h)).toBe(19);
    h.press(h.button(/^Trace/));
    h.press(h.button(/^Evidence$/));
    const create = h.view().nodes.get('fn:src/sessions/store.ts#sessionstore.create')!.mesh;
    expect(create.visible).toBe(true);
    h.press(create); // predict
    expect(h.state().prediction?.correct).toBe(true);
    h.press(h.view().edges.get(BREAK)!.plug!.mesh);
    h.press(h.button(/^Next/));
    h.frames(60);
    expect(h.view().sockets).toHaveLength(3);
    expect(h.view().nodes.get(REVOKE)!.mesh.visible, 'a wrong socket on an extra part comes off the shelf').toBe(true);
    for (const sk of h.view().sockets) expect(sk.mesh.visible, sk.targetId).toBe(true);
    h.press(h.view().sockets.find((s) => s.targetId === 'fn:src/sessions/store.ts#sessionstore.create')!.mesh);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');

    h.press(h.button(/^Incident drill ▸$/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    const first = h.view().nodes.get('fn:src/http/middleware.ts#parsejsonbody')!.mesh;
    expect(first.visible).toBe(true);
    h.press(first);
    expect(h.state().prediction?.correct).toBe(true);
    h.press(h.button(/^Next/));
    h.press(h.view().sockets.find((s) => s.targetId === 'fn:src/http/middleware.ts#parsejsonbody')!.mesh);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');
  });

  it('a quick flick on empty space swipes the extras away, and the other way brings them back', () => {
    const h = setup();
    openCodebase(h);
    const { fire, right } = withHands(h);
    const flick = (from: number, to: number) => {
      right.position.set(from, 1.2, -0.3);
      h.frames(2);
      clock += 300;
      fire('selectstart', 'right'); // the ray is on nothing
      h.frames(1);
      right.position.set(from + (to - from) / 2, 1.2, -0.3);
      h.frames(1);
      right.position.set(to, 1.2, -0.3);
      h.frames(1);
      clock += 150;
      fire('selectend', 'right');
      h.frames(60);
    };
    expect(shown(h)).toBe(44);
    flick(0.15, -0.05);
    expect(h.button(/^Detail: key$/)).toBeDefined();
    expect(shown(h)).toBe(19);
    flick(-0.05, 0.15);
    flick(-0.05, 0.15);
    expect(h.button(/^Detail: all$/)).toBeDefined();
    expect(shown(h)).toBe(67);
    const root = (h.view() as unknown as { root: Object3D }).root;
    expect(Math.abs(root.rotation.y), 'a flick does not leave the model turned').toBeLessThan(0.02);
  });

  it('a mechanical model always shows every part, and its Detail button does nothing', () => {
    localStorage.setItem('explode:detail:v1', 'key');
    const h = setup();
    h.press(h.button(/^Explode$/));
    h.frames(60);
    const total = h.view().nodes.size;
    expect(shown(h)).toBe(total);
    h.press(h.button(/^Detail: all$/));
    h.frames(30);
    expect(shown(h)).toBe(total);
    expect(shelf(h)).toBeUndefined();
  });
});

describe('scene harness: a real SDK, from its most relevant parts', () => {
  /** What src/index.ts ships: the three lesson systems, then the SDK. */
  const withSdk = [...shipped, ContentBundle.parse(sdkJson)];
  const sdk = withSdk[3]!;
  const openSdk = () => {
    const h = setup(false, { bundles: withSdk });
    h.press(h.button(/^More: Drivetrain$/));
    h.press(h.button(/^More: SDK$/));
    expect(h.state().system_id).toBe('system:iwsdk');
    return h;
  };

  it('is one more press under More, and More goes round back to the opening tutorial', () => {
    const h = openSdk();
    expect(h.caption()).toMatch(/Immersive Web SDK/);
    h.press(h.button(/^More: Headset$/));
    expect(h.state().system_id).toBe('system:mr-headset');
  });

  it('is offered when the last codebase lesson is finished', () => {
    const h = setup(false, { bundles: withSdk });
    h.press(h.button(/Skip tutorial/));
    const store = h.store() as unknown as { restart(id?: string): void; dispatch(e: unknown): void };
    store.restart('lesson:repo-incident');
    h.frames(5);
    // Finish the drill through the engine's own events, as the drill test does with presses.
    const drill = repoJson.lessons.find((l) => l.id === 'lesson:repo-incident')!;
    const edge = repoJson.graph.edges.find((e) => e.id === drill.break_edge_id)!;
    store.dispatch({ type: 'next' });
    store.dispatch({ type: 'set_explode', factor: 1 });
    store.dispatch({ type: 'predict', target_id: edge.target_id });
    store.dispatch({ type: 'next' });
    store.dispatch({ type: 'plug', edge_id: edge.id, target_id: edge.target_id });
    store.dispatch({ type: 'next' });
    h.frames(10);
    expect(h.state().lesson?.status).toBe('complete');
    h.press(h.button(/^Real SDK/));
    expect(h.state().system_id).toBe('system:iwsdk');
  });

  it('runs the tour at the key detail level: explode, the chosen groups, a traced call chain, source evidence', () => {
    localStorage.setItem('explode:detail:v1', 'key');
    const h = openSdk();
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    expect(h.caption()).toMatch(/chosen by an AI model \(.+\).*hypothesis/);
    // The groups are labelled as hypotheses, with the truth badge's glyph.
    expect(h.panels().some((p) => p.text.startsWith('◌ '))).toBe(true);
    h.press(h.button(/^Next/));
    h.press(h.button(/^Trace a move$/));
    expect(h.state().active_path_id).toBe('path:sdk-move');
    const path = sdk.graph.paths[0]!;
    const view = h.view() as unknown as { isShown(id: string): boolean; nodes: Map<string, { mesh: Mesh }> };
    for (const id of path.node_ids) expect(view.isShown(id), `${id} is shown while traced`).toBe(true);
    h.press(view.nodes.get(path.node_ids[1]!)!.mesh);
    h.press(h.button(/^Evidence$/));
    const evidence = h.panels().find((p) => p.text.startsWith('EVIDENCE'))?.text ?? '';
    expect(evidence).toMatch(/IN SOURCE/);
    expect(evidence).toMatch(/packages\/.*\.ts:\d+-\d+/);
    h.press(h.button(/^Next/));
    expect(h.state().lesson?.status).toBe('complete');
    expect(h.button(/^Lesson done$/)).toBeDefined(); // nothing follows the tour
    expectFinite(h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('offers nothing to unplug, and stays inside the draw-call budget with every part shown', () => {
    localStorage.setItem('explode:detail:v1', 'all');
    const h = openSdk();
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(90);
    h.press(h.button(/^Next/));
    h.press(h.button(/^Trace/));
    h.frames(30);
    for (const e of h.view().edges.values()) expect(e.plug).toBeNull();
    // With nothing to unplug there is no sandbox tray, and a label that is no longer highlighted is redrawn plain.
    expect(h.panels().some((p) => p.mesh.visible && p.mesh.parent?.visible && /Sandbox tray/.test(p.text))).toBe(false);
    const groupLabel = (h.view().nodes as unknown as Map<string, { node: { kind: string }; labelText: string }>);
    for (const v of groupLabel.values()) if (v.node.kind === 'cluster' && v.labelText) expect(v.labelText.startsWith('#f4f7fb'), v.labelText).toBe(true);
    let draws = 0;
    const walk = (o: Object3D) => {
      if (!o.visible) return;
      const m = o as Mesh & { isMesh?: boolean; isPoints?: boolean; material?: { visible?: boolean } };
      if ((m.isMesh || m.isPoints) && m.material?.visible !== false) draws++;
      o.children.forEach(walk);
    };
    walk(h.scene);
    expect(draws, 'draw calls with the whole SDK selection open').toBeLessThanOrEqual(120);
    for (const v of (h.view().nodes as Map<string, { node: { kind: string }; mesh: Mesh }>).values()) {
      if (v.node.kind !== 'cluster' && v.mesh.visible) expect(v.mesh.scale.x * 2).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe('scene harness: nameplate, view dock and lifelike parts', () => {
  it('names what is on the stage, front and centre, and follows a switch of system', () => {
    const h = setup(false, { bundles: shipped });
    const plate = () => h.panels().find((p) => /^TEACHING MODEL |^CODEBASE/.test(p.text))?.text;
    expect(plate()).toBe('TEACHING MODEL Mixed-reality headset  ▾');
    h.press(h.button(/^More: Drivetrain/));
    expect(plate()).toBe('TEACHING MODEL Simplified EV drivetrain  ▾');
    h.press(h.button(/^Skip tutorial$|^Software/));
    expect(plate()).toBe('CODEBASE · sample TypeScript service auth-service  ▾');
  });

  it('the dock opens the model in quarters, turns, tilts, raises and zooms it, and Home view puts it back', () => {
    const h = setup(false, { bundles: shipped });
    const pose = (h.app as unknown as { hands: { pose: { yaw: number; pitch: number; y: number; zoom: number } } }).hands.pose;
    expect(h.state().explode_factor).toBe(0);
    h.press(h.button(/^Spread \+$/));
    expect(h.state().explode_factor).toBe(0.25);
    h.press(h.button(/^Spread −$/));
    expect(h.state().explode_factor).toBe(0);
    h.press(h.button(/^Turn ▸$/));
    expect(pose.yaw).toBeLessThan(0);
    h.press(h.button(/^Tilt ▲$/));
    expect(pose.pitch).toBeLessThan(0);
    h.press(h.button(/^Raise$/));
    expect(pose.y).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) h.press(h.button(/^Spread \+$/));
    expect(h.state().explode_factor).toBe(1);
    h.press(h.button(/^Zoom \+$/));
    expect(pose.zoom).toBeGreaterThan(1);
    h.press(h.button(/^Home view$/));
    expect([pose.yaw, pose.pitch, pose.y, pose.zoom]).toEqual([0, 0, 0, 1]);
  });

  it('draws every headset and drivetrain part as its own lifelike model that rays pass through', () => {
    for (const b of [headsetJson, drivetrainJson]) {
      const bundle = ContentBundle.parse(b);
      for (const id of Object.keys(bundle.assets?.parts ?? {})) expect(hasLook(bundle.graph.system_id, id), id).toBe(true);
    }
    const h = setup(false, { bundles: shipped });
    const nodes = h.view().nodes as unknown as Map<string, { mesh: Mesh; look: { group: Object3D } | null }>;
    for (const [id, v] of nodes) {
      expect(v.look, id).not.toBeNull();
      expect((v.mesh.material as unknown as { visible: boolean }).visible, `${id}: the hit volume is invisible`).toBe(false);
      v.look!.group.traverse((o) => {
        const hits: unknown[] = [];
        o.raycast({ ray: { intersectsBox: () => true } } as never, hits as never);
        expect(hits, `${id}: its model takes no ray hits`).toEqual([]);
      });
    }
  });
});

describe('scene harness: part context menu', () => {
  const NODE = 'fn:src/sessions/store.ts#sessionstore.create';
  const menuOf = (h: ReturnType<typeof setup>) => (h.app as unknown as { menu: { openFor: string | null; labels: string[] } }).menu;
  const row = (h: ReturnType<typeof setup>, label: RegExp) => h.button(label);

  it('selecting a part opens its menu beside it; an option runs and shuts it until the selection changes', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    expect(menuOf(h).openFor).toBeNull();
    h.press(h.view().nodes.get(NODE)!.mesh);
    expect(h.state().selected_id).toBe(NODE);
    expect(menuOf(h).openFor).toBe(NODE);
    expect(menuOf(h).labels.slice(0, 2)).toEqual(['Explain this (guide)', 'What depends on it? (guide)']); // offline: the scripted guide answers
    expect(menuOf(h).labels.at(-1)).toBe('Deselect');
    expect(h.panels().some((p) => /^SessionStore\.create|create Function · in the code/.test(p.text))).toBe(true);
    h.press(row(h, /^Explain this \(guide\)$/));
    expect(menuOf(h).openFor).toBeNull();
    return vi.waitFor(() => {
      h.frames(3);
      expect(h.caption()).toMatch(/Guide \(offline\)/);
      expect(menuOf(h).openFor).toBeNull(); // still selected, still shut
      expect(h.state().selected_id).toBe(NODE);
    });
  });

  it('offers evidence and Deselect, and Deselect clears the selection', () => {
    const h = setup();
    h.press(h.button(/Skip tutorial/));
    h.press(h.button(/^Next/));
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.view().nodes.get(NODE)!.mesh);
    h.press(row(h, /^Show its evidence$/));
    expect(h.state().evidence_open_id).not.toBeNull();
    h.press(h.view().nodes.get(NODE)!.mesh); // deselect
    h.press(h.view().nodes.get(NODE)!.mesh); // and select again: the menu is back
    expect(menuOf(h).openFor).toBe(NODE);
    h.press(row(h, /^Deselect$/));
    expect(h.state().selected_id).toBeNull();
    expect(menuOf(h).openFor).toBeNull();
  });

  it('the menu shuts when the evidence opens from the toolbar, and when a connection is cut', () => {
    const h = setup(false, { bundles: shipped });
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.view().nodes.get('part:board')!.mesh);
    expect(menuOf(h).openFor).toBe('part:board');
    h.press(h.button(/^Evidence$/));
    expect(h.state().evidence_open_id).not.toBeNull();
    expect(menuOf(h).openFor).toBeNull();
    h.frames(10);
    expect(menuOf(h).openFor).toBeNull(); // stays shut while the same part is selected
    h.press(h.view().nodes.get('part:display')!.mesh);
    expect(menuOf(h).openFor).toBe('part:display'); // a new selection brings it back
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get('edge:transmits:part:cameras->part:board')!.plug!.mesh);
    expect(h.state().broken_edge_ids).toHaveLength(1);
    expect(menuOf(h).openFor).toBeNull();
  });

  it('a mechanical part has a menu too, and no menu opens while a prediction is asked for', () => {
    const h = setup(false, { bundles: shipped });
    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.view().nodes.get('part:board')!.mesh);
    expect(menuOf(h).openFor).toBe('part:board');
    expect(h.panels().some((p) => /Processor board Part · teaching model/.test(p.text))).toBe(true);
    h.press(h.view().nodes.get('part:board')!.mesh);
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get('edge:transmits:part:cameras->part:board')!.plug!.mesh);
    expect(h.state().broken_edge_ids).toHaveLength(1);
    h.press(h.view().nodes.get('part:display')!.mesh); // commits the prediction instead
    expect(h.state().prediction?.target_id).toBe('part:display');
    expect(menuOf(h).openFor).toBeNull();
  });
});

describe('scene harness: Jupiter', () => {
  const DYNAMO = 'edge:powers:part:metallic->part:field';
  const withJupiter = [ContentBundle.parse(headsetJson), ContentBundle.parse(drivetrainJson), ContentBundle.parse(jupiterJson), ContentBundle.parse(repoJson)];

  it('is under More after the drivetrain, and its lesson runs to the end by presses', () => {
    const h = setup(false, { bundles: withJupiter });
    h.press(h.button(/^More: Drivetrain$/));
    h.press(h.button(/^More: Jupiter$/));
    expect(h.state().system_id).toBe('system:jupiter');
    expect(h.caption()).toMatch(/nobody has seen the interior directly/);

    h.press(h.button(/^Explode$/));
    h.frames(60);
    h.press(h.button(/^Trace/));
    h.press(h.view().edges.get(DYNAMO)!.plug!.mesh);
    expect(h.state().broken_edge_ids).toEqual([DYNAMO]);
    h.press(h.view().nodes.get('part:field')!.mesh);
    expect(h.state().prediction).toEqual({ target_id: 'part:field', correct: true });
    // The field and the aurora lose their source; the weather and Io do not.
    expect(h.state().consequences[0]?.affected_ids).toEqual(['part:field', 'part:aurora']);
    expect(h.state().consequences[0]?.truth_status).toBe('authored_model');
    expect(h.caption()).not.toMatch(/We dimmed your view/); // the room dims for the headset's camera link only

    h.press(h.button(/^Next/));
    h.press(h.view().sockets.find((s) => s.targetId === 'part:field')!.mesh);
    expect(h.state().broken_edge_ids).toEqual([]);
    h.press(h.button(/^Collapse$/));
    h.frames(60);
    expect(h.state().lesson?.status).toBe('complete');
    h.press(h.button(/^More: Headset$/));
    expect(h.state().system_id).toBe('system:mr-headset');
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('opens from the outside in and ends exactly on the layout; the field turns while it does', () => {
    const h = setup(false, { bundles: [ContentBundle.parse(jupiterJson), ContentBundle.parse(repoJson)] });
    const layout = ContentBundle.parse(jupiterJson).layout.placements;
    const node = (id: string) => h.view().nodes.get(id)! as unknown as { mesh: Mesh; look: { group: Object3D } };
    const moved = (id: string) => node(id).mesh.position.distanceTo(new Vector3(...layout[id]!.collapsed)) / new Vector3(...layout[id]!.exploded).distanceTo(new Vector3(...layout[id]!.collapsed));
    h.frames(30);
    const turnedBefore = node('part:field').look.group.rotation.y;
    h.press(h.button(/^Explode$/));
    let seen = false;
    for (let i = 0; i < 120; i++) {
      h.frames(1);
      // Part way through (the harness takes long steps): the field has arrived while the core is still on its way.
      if (moved('part:field') > 0.99 && moved('part:core') < 0.8) seen = true;
      expect(moved('part:field')).toBeGreaterThanOrEqual(moved('part:clouds-north') - 1e-6);
      expect(moved('part:clouds-north')).toBeGreaterThanOrEqual(moved('part:core') - 1e-6);
    }
    expect(seen).toBe(true);
    for (const id of Object.keys(layout)) expect(node(id).mesh.position.toArray().map((n) => +n.toFixed(5)), id).toEqual(layout[id]!.exploded);
    expect(node('part:field').look.group.rotation.y).toBeGreaterThan(turnedBefore);
  });
});

describe('scene harness: choosing a project, and loading it', () => {
  const parsed = new Map([headsetJson, drivetrainJson, jupiterJson, repoJson, sdkJson].map((j) => {
    const b = ContentBundle.parse(j);
    return [b.graph.system_id, b] as const;
  }));
  /** The shipped catalog, every bundle fetched on demand through a load the test settles by hand. */
  function lazy() {
    const loads: Array<{ id: string; progress: (p: LoadProgress) => void; resolve: () => void; reject: (e: Error) => void }> = [];
    const projects: Project[] = PROJECTS.map((p) => ({
      ...p,
      load: (progress) =>
        new Promise<ContentBundle>((resolve, reject) => {
          loads.push({ id: p.id, progress, resolve: () => resolve(parsed.get(p.id)!), reject });
        }),
    }));
    const h = setup(false, { bundles: [parsed.get('system:mr-headset')!], projects });
    return { h, loads };
  }
  const plate = (h: ReturnType<typeof setup>) => h.panels().find((p) => isInteractive(p.mesh) && /^TEACHING MODEL |^CODEBASE/.test(p.text))!.mesh;
  const pickerOf = (h: ReturnType<typeof setup>) => (h.app as unknown as { picker: { isOpen: boolean; names: string[] } }).picker;
  const dial = (h: ReturnType<typeof setup>) => h.panels().find((p) => /^(LOADING|COULD NOT LOAD) /.test(p.text) && p.mesh.parent?.parent?.visible);
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('the nameplate drops down every project, marks the one on the stage, and closes again', () => {
    const { h } = lazy();
    h.press(plate(h));
    h.frames(40); // the rows unfold one after another
    expect(pickerOf(h).isOpen).toBe(true);
    expect(pickerOf(h).names).toEqual(['Mixed-reality headset', 'Simplified EV drivetrain', 'Jupiter', 'auth-service', 'Immersive Web SDK']);
    expect(h.button(/ON THE STAGE Mixed-reality headset/)).toBeDefined();
    expect(h.button(/LOADS ON OPEN Jupiter/)).toBeDefined();
    // The caption steps aside while the list is open: a long list's header would stand over its foot.
    const captionPanel = () => h.panels().find((p) => /^How does the room reach your eyes\?/.test(p.text))!.mesh;
    expect(captionPanel().visible).toBe(false);
    h.press(h.button(/^CHOOSE WHAT TO EXPLODE/));
    expect(pickerOf(h).isOpen).toBe(false);
    expect(captionPanel().visible).toBe(true);
    expect(h.button(/LOADS ON OPEN Jupiter/)).toBeUndefined(); // folded away and out of a ray's reach
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('opening an unloaded project: the model leaves, the dial shows the download, and the new model boots', async () => {
    const { h, loads } = lazy();
    h.press(plate(h));
    h.frames(40);
    h.press(h.button(/LOADS ON OPEN Jupiter/));
    expect(pickerOf(h).isOpen).toBe(false);
    const load = loads.find((l) => l.id === 'system:jupiter')!;
    expect(load).toBeDefined();
    expect(h.state().system_id).toBe('system:mr-headset'); // nothing changes until the bundle is in hand
    // Nothing presses through to the model that is leaving.
    h.press(h.button(/^Explode$/));
    expect(h.state().explode_factor).toBe(0);

    load.progress({ phase: 'fetch', fraction: 0.5, bytes: 12_000 });
    h.frames(30);
    expect(h.view()).toBeNull(); // the headset has gone; the dial stands in its place
    expect(dial(h)?.text).toMatch(/^LOADING Jupiter Downloading its parts\s+·\s+\d+%\s+·\s+12 KB$/);
    load.resolve();
    await settle();
    h.frames(60);
    expect(h.state().system_id).toBe('system:jupiter');
    expect(h.caption()).toMatch(/nobody has seen the interior directly/);
    h.frames(60);
    expect(dial(h)).toBeUndefined();
    h.press(h.button(/^Explode$/));
    expect(h.state().explode_factor).toBe(1);

    h.press(plate(h));
    h.frames(40);
    expect(h.button(/ON THE STAGE Jupiter/)).toBeDefined();
    expect(h.button(/^TEACHING MODEL Mixed-reality headset/)).toBeDefined(); // loaded now: no download mark
    expectFinite(h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('a failed download says so on the dial, then brings back what was there', async () => {
    const { h, loads } = lazy();
    h.press(h.button(/^Skip tutorial$/));
    loads.find((l) => l.id === 'system:auth-service')!.reject(new Error('404'));
    await settle();
    h.frames(30);
    expect(dial(h)?.text).toMatch(/^COULD NOT LOAD auth-service Check the connection/);
    h.frames(72 * 3);
    expect(h.state().system_id).toBe('system:mr-headset');
    expect(h.view()).not.toBeNull();
    expect(h.caption()).toMatch(/auth-service could not be loaded/);
    // And it can be tried again.
    h.press(h.button(/^Skip tutorial$/));
    loads.filter((l) => l.id === 'system:auth-service').at(-1)!.resolve();
    await settle();
    h.frames(80);
    expect(h.state().system_id).toBe('system:auth-service');
    expect(h.caption()).not.toMatch(/could not be loaded/);
  });

  it('a prefetched project opens without the dial', async () => {
    const { h, loads } = lazy();
    h.app.prefetch('system:ev-drivetrain');
    loads.find((l) => l.id === 'system:ev-drivetrain')!.resolve();
    await settle();
    h.app.openProject('system:ev-drivetrain');
    expect(loads.filter((l) => l.id === 'system:ev-drivetrain')).toHaveLength(1); // one download, shared
    h.frames(20);
    expect(dial(h)).toBeUndefined();
    expect(h.state().system_id).toBe('system:ev-drivetrain');
  });
});

// ---------------------------------------------------------------- explode anything (ADR-0026)

describe('scene harness: explode anything', () => {
  // A real bundle, built by the real builder from the fixture repository (no network, no model).
  const dir = mkdtempSync(join(tmpdir(), 'explode-harness-'));
  writeFixture(dir);
  const out = buildFromCuration(indexAnyRepo(dir, FIXTURE_SOURCE), FIXTURE_SOURCE, JSON.stringify(FIXTURE_ANSWER), { provider: 'test', model: 'test-model-1', created_at: '2026-11-13T00:00:00.000Z' });
  rmSync(dir, { recursive: true, force: true });
  if (!out.ok) throw new Error(out.problems.join('\n'));
  const built = out.result.bundle;
  const BUILT_ID = 'system:gh/example-org/fixture.shop@c0ffee123456';

  const proposal: RepositoryProposal = {
    kind: 'repository',
    title: 'Explode Example-Org/Fixture.Shop',
    repository: { full_name: 'Example-Org/Fixture.Shop', url: 'https://github.com/Example-Org/Fixture.Shop', commit: FIXTURE_SOURCE.commit, default_branch: 'main', license: 'MIT License' },
    found_by_search: null,
    counts: { files_total: 15, files_readable: 10, bytes_readable: 2400 },
    creates: [
      'A model of Example-Org/Fixture.Shop from its 10 TypeScript and JavaScript source files, as they are at commit c0ffee1.',
      'At most 46 classes and functions, the ones the call graph ranks highest, in 4 to 8 groups.',
      'A short tour: explode it, read the groups, follow one real chain of calls, and check a part against its source lines.',
    ],
    leaves_out: [
      'Nothing in the repository is installed or run, so there are no test results and nothing to break and repair.',
      'Tests, build output, configuration and other languages are not read (5 of 15 files).',
      'The model stays on this server for a few hours and in your browser; it is not published.',
    ],
    disclosure: 'Parts and connections come from the source at that commit and cite their lines. The groups are chosen by an AI model and are marked as hypotheses. None of the code is run, so nothing is marked observed and no connection can be unplugged.',
    estimate: null,
  };
  const job = (over: Partial<ExplodeJob>): ExplodeJob => ({ id: 'job-0001-0001', kind: 'repository', status: 'researching', stage: null, proposal: null, refusal: null, error: null, system_id: null, build_seconds: null, ...over });

  /** A build server that answers from a script: each poll takes the next job state. */
  function server(script: { research?: ExplodeJob[]; build?: ExplodeJob[]; bundle?: unknown; available?: boolean | boolean[]; retryMs?: number[]; estimate?: ExplodeProposal['estimate']; proposal?: ExplodeProposal; builtId?: string } = {}) {
    const calls: string[] = [];
    const withEstimate: ExplodeProposal = { ...(script.proposal ?? proposal), estimate: script.estimate ?? null };
    const research = [...(script.research ?? [job({ stage: { id: 'research', fraction: null } }), job({ status: 'proposed', proposal: withEstimate })])];
    const build = [
      ...(script.build ?? [
        job({ status: 'building', proposal: withEstimate, stage: { id: 'download', fraction: null }, build_seconds: 0.4 }),
        job({ status: 'building', proposal: withEstimate, stage: { id: 'index', fraction: null }, build_seconds: 1.6 }),
        job({ status: 'building', proposal: withEstimate, stage: { id: 'curate', fraction: null }, build_seconds: 3.2 }),
        job({ status: 'done', proposal: withEstimate, system_id: script.builtId ?? BUILT_ID, build_seconds: 5.5 }),
      ]),
    ];
    let confirmed = false;
    const api: ExplodeApi = {
      available: async () => {
        calls.push('available');
        const a = script.available ?? true;
        return Array.isArray(a) ? (a.length > 1 ? a.shift()! : a[0]!) : a;
      },
      propose: async (request) => {
        calls.push(`propose ${request.kind} ${request.query}`);
        return research.shift()!;
      },
      job: async () => {
        calls.push('job');
        const queue = confirmed ? build : research;
        return queue.length > 1 ? queue.shift()! : queue[0]!;
      },
      confirm: async (id) => {
        calls.push(`confirm ${id}`);
        confirmed = true;
        return build.shift()!;
      },
      cancel: async (id) => void calls.push(`cancel ${id}`),
      bundle: async (id) => {
        calls.push(`bundle ${id}`);
        const raw = script.bundle ?? built;
        // The real client checks what it is sent before handing it over (explode-client.ts).
        const { checkedBundle } = await import('../src/app/explode-client.ts');
        return checkedBundle(structuredClone(raw));
      },
    };
    return { api, calls };
  }

  const parsed = [headsetJson, drivetrainJson, jupiterJson, repoJson, sdkJson].map((j) => ContentBundle.parse(j));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  async function start(script: Parameters<typeof server>[0] = {}) {
    const s = server(script);
    const saved = new MemorySavedSystems();
    const h = setup(false, { bundles: parsed, explode: { api: s.api, saved, retryMs: script.retryMs ?? [] } });
    await settle();
    /** Let the answers arrive and the app poll again: a second of frames, twice. */
    const wait = async (rounds = 2) => {
      for (let i = 0; i < rounds; i++) {
        await settle();
        h.frames(72);
        await settle();
      }
    };
    const card = () => h.app.proposalText;
    const projects = () => h.app.projectList.map((p) => p.id);
    // The availability checks at start are not part of what a test does.
    s.calls.length = 0;
    return { ...s, saved, h, wait, card, projects };
  }
  const plate = (h: ReturnType<typeof setup>) => h.panels().find((p) => isInteractive(p.mesh) && /^TEACHING MODEL |^CODEBASE/.test(p.text))!.mesh;
  const pickerOf = (h: ReturnType<typeof setup>) => (h.app as unknown as { picker: { isOpen: boolean; names: string[] } }).picker;
  /** Every object the renderer would issue a draw call for (the same count the shipped scenes are held to). */
  const drawCalls = (h: ReturnType<typeof setup>) => {
    let draws = 0;
    const walk = (o: Object3D) => {
      if (!o.visible) return;
      const m = o as Mesh & { isMesh?: boolean; isPoints?: boolean; material?: { visible?: boolean } };
      if ((m.isMesh || m.isPoints) && m.material?.visible !== false) draws++;
      o.children.forEach(walk);
    };
    walk(h.scene);
    return draws;
  };
  /** A button on the proposal card itself (the evidence panel has a Close of its own). */
  const onCard = (h: ReturnType<typeof setup>, label: RegExp) => h.panels().find((p) => isInteractive(p.mesh) && p.mesh.visible && p.mesh.renderOrder === 41 && label.test(p.text))?.mesh;

  it('offers no way in without a build server, or while the server says it cannot build', async () => {
    const plain = setup(false, { bundles: parsed });
    plain.press(plate(plain));
    plain.frames(40);
    expect(pickerOf(plain).names).toHaveLength(5);
    expect(plain.app.canPropose).toBe(false);
    plain.app.proposeSystem('honojs/hono');
    expect(plain.app.proposalText).toBe('');

    const off = await start({ available: false });
    off.h.press(plate(off.h));
    off.h.frames(40);
    expect(pickerOf(off.h).names).not.toContain('Explode anything…');
    off.h.app.proposeSystem('honojs/hono');
    await off.wait(1);
    expect(off.calls).toEqual([]);
    expect(off.card()).toBe('');
    expect(off.h.caption()).toMatch(/not available right now/);
  });

  it('asks a server that was asleep again, and opens the way in once it answers', async () => {
    const t = await start({ available: [false, false, true], retryMs: [5, 5] });
    expect(t.h.app.canPropose).toBe(false);
    expect(await t.h.app.explodeReady).toBe(true);
    expect(t.h.app.canPropose).toBe(true);
    t.h.press(plate(t.h));
    t.h.frames(60);
    expect(pickerOf(t.h).names.at(-1)).toBe('Explode anything…');

    // It gives up after the last wait, and the app stays as it was.
    const never = await start({ available: false, retryMs: [5] });
    expect(await never.h.app.explodeReady).toBe(false);
    expect(never.h.app.canPropose).toBe(false);
  });

  it('the picker ends with a row that says how to ask', async () => {
    const t = await start();
    t.h.press(plate(t.h));
    t.h.frames(60);
    expect(pickerOf(t.h).names.at(-1)).toBe('Explode anything…');
    t.h.press(t.h.button(/^NEW Explode anything… A GitHub repository, or a subject drafted by AI/));
    expect(pickerOf(t.h).isOpen).toBe(false);
    expect(t.h.caption()).toMatch(/Type a GitHub address/);
    expect(t.calls).toEqual([]); // the row explains; it looks nothing up
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('shows a proposal before anything is built, and Cancel leaves nothing behind', async () => {
    const t = await start();
    const before = t.projects();
    t.h.app.proposeSystem('  https://github.com/Example-Org/Fixture.Shop  ');
    expect(t.card()).toMatch(/^LOOKING IT UP\nhttps:\/\/github.com\/Example-Org\/Fixture.Shop\n.*Nothing is being built/);
    await t.wait();
    const text = t.card();
    expect(text).toMatch(/^PROPOSAL {2}· {2}NOTHING IS BUILT YET\nExample-Org\/Fixture.Shop\ncommit c0ffee1 of main {2}· {2}licence: MIT License/);
    expect(text).toContain('WILL CREATE');
    expect(text).toContain('10 TypeScript and JavaScript source files');
    expect(text).toContain('WILL NOT');
    expect(text).toContain('Nothing in the repository is installed or run');
    expect(text).toMatch(/◌ .*marked as hypotheses/);
    expect(text).toContain('How long: unknown. This server has not timed a build yet.');
    expect(t.h.button(/^Build$/)).toBeDefined();
    expect(t.h.button(/^Cancel$/)).toBeDefined();
    // Waiting on the learner: however long they read, nothing is confirmed and nothing is polled.
    const polls = t.calls.length;
    await t.wait(3);
    expect(t.calls.length).toBe(polls);
    expect(t.calls.some((c) => c.startsWith('confirm') || c.startsWith('bundle'))).toBe(false);
    expect(TextPanel.clipEvents).toEqual([]);

    t.h.press(t.h.button(/^Cancel$/));
    await t.wait(1);
    expect(t.card()).toBe('');
    expect(t.h.button(/^Build$/)).toBeUndefined();
    expect(t.calls.at(-1)).toBe('cancel job-0001-0001');
    expect(t.calls.some((c) => c.startsWith('confirm'))).toBe(false);
    expect(t.projects()).toEqual(before);
    expect(await t.saved.list()).toEqual([]);
    expect(t.h.state().system_id).toBe('system:mr-headset');
  });

  it('says how long from the server\'s own timings when it has them', async () => {
    const t = await start({ estimate: { low_seconds: 5, high_seconds: 8, basis: '3 earlier builds on this server' } });
    t.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await t.wait();
    expect(t.card()).toContain('How long: about 5 to 8 seconds, going by 3 earlier builds on this server.');
  });

  it('Build shows each real stage, then opens the system, where a part can be checked against its source', async () => {
    const t = await start();
    t.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await t.wait();
    t.h.press(t.h.button(/^Build$/));
    await settle();
    t.h.frames(5);
    expect(t.calls).toContain('confirm job-0001-0001');
    expect(t.card()).toMatch(/^BUILDING\nExample-Org\/Fixture.Shop\nDownloading the source at that commit\n0 s so far$/);
    expect(t.h.button(/^Stop$/)).toBeDefined();
    expect(t.h.button(/^Build$/)).toBeUndefined();
    await t.wait(1);
    expect(t.card()).toMatch(/Reading the source and finding the calls\n1 s so far$/);
    await t.wait(1);
    expect(t.card()).toMatch(/Asking the AI model to group the parts\n3 s so far$/);
    await t.wait(3);

    expect(t.calls).toContain('bundle job-0001-0001');
    expect(t.card()).toBe('');
    expect(t.h.state().system_id).toBe(BUILT_ID);
    expect(t.projects().at(-1)).toBe(BUILT_ID);
    expect((await t.saved.list()).map((s) => s.id)).toEqual([BUILT_ID]);
    expect(t.h.caption()).toMatch(/This is Example-Org\/Fixture.Shop, read from GitHub at commit c0ffee1.*None of it was run/);

    // The tour, by hand: explode, read the groups, trace the real chain, open the source lines.
    t.h.press(t.h.button(/^Next ▸$/));
    t.h.press(t.h.button(/^Explode$/));
    expect(t.h.caption()).toMatch(/chosen by an AI model \(test-model-1\).*marked a hypothesis/);
    t.h.press(t.h.button(/^Next ▸$/));
    t.h.press(t.h.button(/^Trace the calls from Server$/));
    expect(t.h.state().active_path_id).toBe('path:calls');
    t.h.press(t.h.view().nodes.get('fn:src/core/auth.ts#authenticate')!.mesh);
    t.h.press(t.h.button(/^Evidence$/));
    const evidence = t.h.panels().map((p) => p.text).find((x) => /IN SOURCE/.test(x) && /auth\.ts/.test(x)) ?? '';
    expect(evidence).toContain('src/core/auth.ts');
    expect(evidence).toContain('export function authenticate(name: string): string {');
    expect(evidence).toContain('@ commit c0ffee123456'); // a git commit, and called one
    expect(FIXTURE_FILES['src/core/auth.ts']).toContain('export function authenticate(name: string): string {');
    expect(drawCalls(t.h), 'draw calls in a built repository, traced, with evidence open').toBeLessThanOrEqual(120);
    // Nothing in it can be unplugged, and nothing is called observed.
    expect([...t.h.view().edges.values()].every((e) => e.plug === null)).toBe(true);
    expect(t.h.panels().some((p) => /OBSERVED/.test(p.text))).toBe(false);

    // It is in the picker, marked as built here, after the shipped systems and before the new-build row.
    t.h.press(plate(t.h));
    t.h.frames(70);
    expect(pickerOf(t.h).names.slice(-2)).toEqual(['Fixture.Shop', 'Explode anything…']);
    expect(t.h.button(/^BUILT HERE · Example-Org\/Fixture.Shop\s+·\s+● {2}ON THE STAGE Fixture.Shop Built for you/)).toBeDefined();
    expectFinite(t.h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('Stop during a build cancels it, and nothing is added', async () => {
    const t = await start();
    const before = t.projects();
    t.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await t.wait();
    t.h.press(t.h.button(/^Build$/));
    await settle();
    t.h.frames(5);
    t.h.press(t.h.button(/^Stop$/));
    await t.wait(4);
    expect(t.calls.filter((c) => c.startsWith('cancel'))).toEqual(['cancel job-0001-0001']);
    expect(t.calls.some((c) => c.startsWith('bundle'))).toBe(false);
    expect(t.card()).toBe('');
    expect(t.projects()).toEqual(before);
    expect(t.h.state().system_id).toBe('system:mr-headset');
  });

  it('a refusal, a failed build and an unreachable server each say why, and add nothing', async () => {
    const refused = await start({ research: [job({}), job({ status: 'refused', refusal: 'No TypeScript or JavaScript source was found in psf/requests. Those are the only languages this can read so far.' })] });
    refused.h.app.proposeSystem('psf/requests');
    await refused.wait();
    expect(refused.card()).toBe('CANNOT BUILD THAT\nNo TypeScript or JavaScript source was found in psf/requests. Those are the only languages this can read so far.');
    expect(refused.h.button(/^Build$/)).toBeUndefined();
    expect(refused.h.button(/^Cancel$/)).toBeUndefined();
    refused.h.press(onCard(refused.h, /^Close$/));
    expect(refused.card()).toBe('');
    expect(refused.calls.some((c) => c.startsWith('cancel'))).toBe(false); // nothing left on the server to cancel

    const failed = await start({ build: [job({ status: 'building', stage: { id: 'curate', fraction: null }, build_seconds: 2 }), job({ status: 'failed', error: 'The AI model that groups the parts did not answer. Nothing was built.' })] });
    failed.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await failed.wait();
    failed.h.press(failed.h.button(/^Build$/));
    await failed.wait(3);
    expect(failed.card()).toBe('NOT BUILT\nThe AI model that groups the parts did not answer. Nothing was built.');
    expect(failed.projects()).toHaveLength(5);

    const down = await start();
    down.api.propose = async () => {
      throw new ExplodeError('The build server could not be reached.');
    };
    down.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await down.wait(1);
    expect(down.card()).toBe('COULD NOT LOOK IT UP\nThe build server could not be reached.');
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('refuses to open a built bundle that breaks the truth contract', async () => {
    const tampered = structuredClone(built);
    tampered.graph.nodes.find((n) => n.role === 'concept')!.truth_status = 'observed';
    const t = await start({ bundle: tampered });
    t.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await t.wait();
    t.h.press(t.h.button(/^Build$/));
    await t.wait(5);
    expect(t.card()).toMatch(/^BUILT, BUT NOT OPENED\nWhat was built did not pass its checks, so it was not opened\.$/);
    expect(t.projects()).toHaveLength(5);
    expect(await t.saved.list()).toEqual([]);
    expect(t.h.state().system_id).toBe('system:mr-headset');
  });

  it('a typed GitHub address proposes directly, and the assistant can only press the buttons the card shows', async () => {
    const t = await start();
    const internals = t.h.app as unknown as { runCommand(c: unknown): void; viewContext(): { can_propose: boolean; buttons: Array<{ id: string; label: string; enabled: boolean }> } };
    const buttonState = (id: string) => internals.viewContext().buttons.find((b) => b.id === id)!;
    expect(internals.viewContext().can_propose).toBe(true);
    expect(buttonState('build-system').enabled).toBe(false);

    // Pressing Build with no proposal up does nothing.
    internals.runCommand({ type: 'press', button_id: 'build-system' });
    expect(t.calls).toEqual([]);

    expect(await t.h.app.ask('please explode github.com/Example-Org/Fixture.Shop for me!')).toBeNull();
    expect(t.calls).toEqual(['propose repository github.com/Example-Org/Fixture.Shop']);
    await t.wait();
    expect(buttonState('build-system')).toMatchObject({ label: 'Build', enabled: true });
    expect(buttonState('cancel-build')).toMatchObject({ label: 'Cancel', enabled: true });
    // The toolbar did not grow: these two belong to the card.
    expect(t.h.panels().filter((p) => isInteractive(p.mesh) && p.mesh.visible && /^Build$/.test(p.text))).toHaveLength(1);

    // The assistant's command opens a proposal and never a build; a second one waits its turn.
    internals.runCommand({ type: 'propose_system', kind: 'repository', query: 'honojs/hono' });
    expect(t.calls.filter((c) => c.startsWith('propose'))).toHaveLength(1);
    t.h.frames(5);
    expect(t.h.caption()).toMatch(/One proposal at a time/);

    // "Yes, build it" is the same press as a hand's.
    internals.runCommand({ type: 'press', button_id: 'build-system' });
    await t.wait(6);
    expect(t.calls).toContain('confirm job-0001-0001');
    expect(t.h.state().system_id).toBe(BUILT_ID);
  });

  // ---- a subject, drafted by a model

  const draft = buildSubjectBundle(DRAFT, META);
  const subjectProposal: SubjectProposal = {
    kind: 'subject',
    title: 'An AI draft of Lantern World',
    subject: { name: 'Lantern World', summary: 'The layers of Lantern World and the weather above them.' },
    outline: ['Crust', 'Mantle', 'Core', 'Thin air', 'Dust storm', 'Polar ice'],
    sources: [
      { title: 'Lantern World', url: 'https://en.wikipedia.org/wiki/Lantern_World' },
      { title: 'Weather of Lantern World', url: 'https://en.wikipedia.org/wiki/Weather_of_Lantern_World' },
    ],
    model: 'test-model-1',
    creates: [
      'A model of Lantern World with about 6 parts, drafted by test-model-1 from the Wikipedia articles Lantern World and Weather of Lantern World.',
      'A short lesson: open it up, follow one chain of cause and effect, cut one link and see what the draft says would stop.',
    ],
    leaves_out: [
      'No one checks the draft, and it is not compared with the articles after it is written.',
      'Shapes, sizes and colours are rough stand-ins chosen by the model. Nothing is to scale and nothing is a picture of the real thing.',
      'The model stays on this server for a few hours and in your browser; it is not published.',
    ],
    disclosure: 'Everything in it will be written by an AI model and marked as a hypothesis. Nobody checks it. It is a draft to explore, not a reference: where it matters, check it against a source you trust.',
    estimate: null,
  };
  const subjectServer = () =>
    start({
      proposal: subjectProposal,
      builtId: draft.graph.system_id,
      bundle: draft,
      research: [job({ kind: 'subject', stage: { id: 'plan', fraction: null } }), job({ kind: 'subject', stage: { id: 'outline', fraction: null } }), job({ kind: 'subject', status: 'proposed', proposal: subjectProposal })],
      build: [job({ kind: 'subject', status: 'building', proposal: subjectProposal, stage: { id: 'draft', fraction: null }, build_seconds: 1.2 }), job({ kind: 'subject', status: 'done', proposal: subjectProposal, system_id: draft.graph.system_id, build_seconds: 4 })],
    });

  it('anything that is not a GitHub address is proposed as a subject, and the card says whose words it shows', async () => {
    const t = await subjectServer();
    t.h.app.proposeSystem('I want to explore Lantern World');
    expect(t.calls).toEqual(['propose subject I want to explore Lantern World']);
    expect(t.card()).toMatch(/^LOOKING IT UP\nI want to explore Lantern World\nReading about it\. Nothing is being built\.$/);
    await t.wait(1);
    expect(t.card()).toContain('Asking the AI model what its parts would be. Nothing is being built.');
    await t.wait(2);
    const text = t.card();
    expect(text).toMatch(/^PROPOSAL {2}· {2}NOTHING IS BUILT YET\nLantern World {2}· {2}an AI draft\n◌ test-model-1 says: The layers of Lantern World/);
    expect(text).toContain('Expected parts: Crust, Mantle, Core, Thin air, Dust storm, Polar ice.');
    expect(text).toContain('Read for it: Lantern World; Weather of Lantern World (Wikipedia).');
    expect(text).toContain('No one checks the draft');
    expect(text).toMatch(/◌ Everything in it will be written by an AI model and marked as a hypothesis\. Nobody checks it\./);
    expect(text).toContain('How long: unknown.');
    expect(t.calls.some((c) => c.startsWith('confirm'))).toBe(false);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('a built draft opens as a model whose every part says it is a hypothesis, through the whole lesson', async () => {
    const t = await subjectServer();
    t.h.app.proposeSystem('Lantern World', 'subject');
    await t.wait(3);
    t.h.press(t.h.button(/^Build$/));
    await settle();
    t.h.frames(5);
    expect(t.card()).toMatch(/^BUILDING\nLantern World\nThe AI model is writing the draft\n1 s so far$/);
    await t.wait(4);
    expect(t.h.state().system_id).toBe(draft.graph.system_id);
    expect((await t.saved.list())[0]).toMatchObject({ id: draft.graph.system_id, kind: 'mechanical', name: 'Lantern World (AI draft)' });
    // The nameplate and the first caption say what it is before anything else.
    expect(t.h.panels().some((p) => /^AI DRAFT Lantern World/.test(p.text))).toBe(true);
    expect(t.h.caption()).toMatch(/This is an AI draft of Lantern World, written just now by test-model-1.*Nobody has checked it/);

    t.h.press(t.h.button(/^Explode$/));
    // Every label carries the hypothesis glyph.
    const labels = t.h.panels().map((p) => p.text).filter((x) => /^◌ /.test(x));
    expect(labels).toEqual(expect.arrayContaining(['◌ Crust', '◌ Thin air', '◌ Dust storm', '◌ Core']));
    expect(t.h.panels().some((p) => /^(Crust|Thin air|Dust storm|Core)$/.test(p.text))).toBe(false);
    // A selected part is called an AI draft, never a teaching model.
    t.h.press(t.h.view().nodes.get('part:core')!.mesh);
    expect(t.h.panels().some((p) => /Part · AI draft, not checked/.test(p.text))).toBe(true);
    expect(t.h.panels().some((p) => /teaching model/i.test(p.text) && p.mesh.visible && /Core/.test(p.text))).toBe(false);
    expect(t.h.button(/^Evidence$/)).toBeDefined();

    t.h.press(t.h.button(/^Next ▸$/));
    t.h.press(t.h.button(/^Trace warm ground to the dust storm$/));
    const edge = draft.lessons[0]!.break_edge_id!;
    const internals = t.h.app as unknown as { runCommand(c: unknown): void };
    internals.runCommand({ type: 'unplug', edge_id: edge });
    t.h.frames(20);
    expect(t.h.state().broken_edge_ids).toEqual([edge]);
    internals.runCommand({ type: 'predict', target_id: 'part:air' });
    t.h.frames(40);
    expect(drawCalls(t.h), 'draw calls in a draft, open, cut, with its consequence shown').toBeLessThanOrEqual(120);
    // What follows the cut is the draft's say-so: a hypothesis, never the teaching model's rule.
    expect(t.h.state().consequences[0]).toMatchObject({ truth_status: 'inferred', evidence_ids: [] });
    const shown = t.h.panels().map((p) => p.text).join(' | ');
    expect(shown).toMatch(/HYPOTHESIS/);
    expect(shown).not.toMatch(/TEACHING MODEL · not a measurement/);
    expect(shown).not.toMatch(/OBSERVED/);
    expect(t.h.caption()).toMatch(/That is what this draft says would happen\. It is not a measurement/);

    t.h.press(t.h.button(/^Next ▸$/));
    internals.runCommand({ type: 'plug', edge_id: edge, target_id: 'part:air' });
    t.h.frames(20);
    t.h.press(t.h.button(/^Collapse$/));
    t.h.frames(60);
    expect(t.h.state().lesson?.status).toBe('complete');
    expect(t.h.caption()).toMatch(/That was an AI draft, and nobody has checked it/);
    expectFinite(t.h.scene);
    expect(TextPanel.clipEvents).toEqual([]);
  });

  it('asking for a repository by name is a repository request, and the card warns that it was found by searching', async () => {
    const t = await start({ research: [job({}), job({ status: 'proposed', proposal: { ...proposal, found_by_search: 'fixture.shop' } })] });
    t.h.app.proposeSystem('the fixture.shop repo');
    expect(t.calls).toEqual(['propose repository the fixture.shop repo']);
    await t.wait();
    expect(t.card()).toContain('Found by searching GitHub for "fixture.shop", most starred first. Check it is the one you meant.');
    expect(TextPanel.clipEvents).toEqual([]);
    // With an address there is no such line.
    const direct = await start();
    direct.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await direct.wait();
    expect(direct.card()).not.toContain('Found by searching');
  });

  it('a built system can be removed: from the list, from storage, and from the stage', async () => {
    const t = await start();
    t.h.app.proposeSystem('Example-Org/Fixture.Shop');
    await t.wait();
    t.h.press(t.h.button(/^Build$/));
    await t.wait(6);
    expect(t.h.state().system_id).toBe(BUILT_ID);
    expect(t.h.app.isBuilt(BUILT_ID)).toBe(true);
    // A shipped system cannot be removed.
    expect(t.h.app.isBuilt('system:jupiter')).toBe(false);
    t.h.app.removeBuilt('system:jupiter');
    expect(t.projects()).toHaveLength(6);

    let told = 0;
    t.h.app.onProjectsChange = () => told++;
    t.h.app.removeBuilt(BUILT_ID);
    await t.wait(2);
    expect(t.projects()).not.toContain(BUILT_ID);
    expect(await t.saved.list()).toEqual([]);
    expect(t.h.state().system_id).toBe('system:mr-headset'); // the opening tutorial took its place
    expect(told).toBe(1);
    t.h.press(plate(t.h));
    t.h.frames(60);
    expect(pickerOf(t.h).names).not.toContain('Fixture.Shop');
  });
});
