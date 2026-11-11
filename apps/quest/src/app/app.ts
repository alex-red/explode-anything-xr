import { createSystem, Group, SessionMode, Vector3, VisibilityState, type Entity, type World } from '@iwsdk/core';
import type { ContentBundle, EngineEvent, Evidence, TutorTrigger } from '@explode/contracts';
import { currentLesson, currentStep } from '@explode/lesson-engine';
import { Sfx, type At } from './audio.ts';
import { Backdrop } from './backdrop.ts';
import { DebugReadout } from './debug-readout.ts';
import { DeskMemory, type AnchorFrame, type DeskPose } from './desk-memory.ts';
import { FovMask, type LayoutMode } from './fov.ts';
import { GraphView, STAGE_Y } from './graph-view.ts';
import type { RoomSystem } from './room.ts';
import { Store } from './store.ts';
import type { Placement, Viewer } from './surface-pick.ts';
import { TutorClient, type TutorAnswer } from './tutor-client.ts';
import { HandGestures } from './hand-gestures.ts';
import { tickHolo } from './holo.ts';
import { consequenceText, SpatialUI, type ButtonDef, type CaptionModel } from './ui.ts';

const ANCHOR_DISTANCE = 0.7; // m in front of the eyes; nearest parts stay within seated reach
const ANCHOR_DROP = 0.14; // m below eye level, so the object sits above the hands
const DESK_CLEARANCE = 0.005; // m the stage floats above the desk, so it never z-fights the real surface
const LATE_PLANE_WINDOW = 3; // s after a session starts in which a newly reported desk still moves the stage
const RECALL_WINDOW = 6; // s after a session starts in which a restored anchor still returns the stage to its remembered spot
const SESSION_START_SETTLE_FRAMES = 10; // frames to wait for a real head pose before recentering
const VIEW_EASE = 18; // 1/s: how fast the model follows a hand gesture; high enough to feel held
const LAYOUT_KEY = 'explode:layout:v1';
const NO_INPUT_HINT_AFTER = 3; // s in a session with no hand or controller before the hint shows
const NO_INPUT_HINT = "I can't see your hands. Hold them up in view, or pick up a controller.";
/**
 * The headset lesson's break: cutting the camera link dims the real room (WIN_PLAN W3). It is an
 * illustration of what the link carries, said so at the moment it happens; the headset is not
 * changed, and the user's real hand tracking keeps working.
 */
const ROOM_LINK = { system: 'system:mr-headset', edge: 'edge:transmits:part:cameras->part:board' };
const ROOM_DIM_NOTE = 'We dimmed your view of the room to show what this link carries. Your headset is fine, and your hands still work.';

/** Top-level controller: owns the store, view, UI, tutor, and input glue. */
export class ExplodeApp {
  private readonly store: Store;
  private readonly anchor = new Group();
  private readonly anchorEntity: Entity;
  private view: GraphView | null = null;
  private readonly ui: SpatialUI;
  private readonly tutor: TutorClient;
  private readonly hands: HandGestures;
  private readonly backdrop: Backdrop;
  private readonly debug: DebugReadout;
  private readonly fovMask = new FovMask();
  private readonly eyeLocal = new Vector3();
  private readonly sfx = new Sfx();
  private readonly software: ContentBundle;
  /** Tutorial systems in the order given; the first is the opening lesson, the rest are under "More". */
  private readonly tutorials: ContentBundle[];
  private roomDimmed = false;
  /** The broken edge whose spreading failure has already been played, so it plays once. */
  private cascadePlayedFor: string | null = null;
  private lessonWasComplete = false;
  private tutorAnswer: (TutorAnswer & { stepKey: string }) | null = null;
  private liveAllowed = true;
  private paused = false;
  private needsRecenter = true;
  private lastStepKey = '';
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();
  private readonly viewer: Viewer = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
  private readonly desk: Placement = { x: 0, y: 0, z: 0, index: -1 };
  /** Where the stage is: on a detected desk, back on the desk spot remembered from a past session, or floating. */
  private placedOn: 'desk' | 'remembered' | 'air' = 'air';
  private readonly deskMemory = new DeskMemory();
  private readonly recalled: DeskPose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** A desk placement waiting for the anchor before it can be remembered. */
  private pendingSave = false;
  /** This session has settled where the stage goes: recalled, or the viewer chose with Recenter. */
  private recallSettled = false;
  private sessionAge = 0;

  constructor(
    private readonly world: World,
    bundles: ContentBundle[],
    tutorUrl: string | null,
    debug = false,
    private readonly room: RoomSystem | null = null,
    private readonly anchors: (AnchorFrame & { tick?(): void }) | null = null,
  ) {
    const software = bundles.find((b) => b.graph.system_kind === 'software');
    const tutorials = bundles.filter((b) => b.graph.system_kind === 'mechanical');
    if (!software || tutorials.length === 0) throw new Error('expected one software bundle and at least one mechanical bundle');
    this.software = software;
    this.tutorials = tutorials;
    this.store = new Store(new Map(bundles.map((b) => [b.graph.system_id, b])));
    this.tutor = new TutorClient(tutorUrl);
    this.anchorEntity = world.createTransformEntity(this.anchor);
    this.backdrop = new Backdrop(world);
    this.debug = new DebugReadout(world, this.anchorEntity);
    this.debug.enabled = debug;
    this.ui = new SpatialUI(world, this.anchorEntity, this.buttons(), () => this.dispatch({ type: 'open_evidence', evidence_id: null }));
    this.ui.setLayout(readLayout());
    world.createTransformEntity(this.fovMask.group, { parent: this.anchorEntity });
    this.hands = new HandGestures(
      world,
      this.anchor,
      () => this.store.state.explode_factor,
      (f) => {
        if (this.view) this.view.pullPreview = f;
      },
      (f) => this.dispatch({ type: 'set_explode', factor: f }),
    );

    this.store.subscribe((_, event) => {
      this.ui.dirty = true;
      this.onEvent(event);
      this.syncRoomDim();
      this.syncSound();
    });
    const last = Store.lastActiveSystem();
    this.loadSystem(last && bundles.some((b) => b.graph.system_id === last) ? last : this.opening.graph.system_id);

    world.visibilityState.subscribe((v) => {
      this.paused = v === VisibilityState.Hidden || v === VisibilityState.VisibleBlurred;
      if (v === VisibilityState.Hidden) this.sfx.suspend();
      if (v === VisibilityState.Visible) this.needsRecenter ||= !this.recenteredInXR;
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Planes can arrive a moment after the session starts. If the stage is still floating and
    // the viewer has barely begun, move it onto the desk; later than that it stays where it is.
    if (room) {
      room.onPlaneAdded = () => {
        if (this.world.session && this.placedOn === 'air' && this.sessionAge < LATE_PLANE_WINDOW) this.requestRecenter();
      };
    }
  }

  private recenteredInXR = false;

  private recenterWait = 0;

  /** A session started or ended: pick the backdrop it needs and re-place the system. */
  onSessionChange(active: boolean): void {
    if (active) this.backdrop.onSessionStart(this.world.renderer.xr.getSession()?.environmentBlendMode);
    else this.backdrop.onSessionEnd();
    this.syncRoomDim();
    this.ui.dirty = true;
    this.sessionAge = 0;
    this.pendingSave = false;
    this.recallSettled = false;
    this.requestRecenter(SESSION_START_SETTLE_FRAMES);
  }

  /**
   * Re-place the system in front of the viewer. `afterFrames` delays it: right after a session
   * starts the camera still holds the 2D page's pose, and recentering on that puts the object
   * at waist height behind the view. A few frames later the head pose is real.
   */
  requestRecenter(afterFrames = 0): void {
    this.needsRecenter = true;
    this.recenterWait = afterFrames;
  }

  update(dt: number): void {
    const camera = this.world.camera;
    this.sessionAge += dt;
    if (this.needsRecenter) this.tryRecenter();
    this.anchors?.tick?.();
    this.rememberDesk();
    this.backdrop.update(camera, dt);
    this.sfx.updateListener(camera);
    this.hands.update();
    this.applyViewPose(dt);
    this.debug.update(dt);
    if (this.paused) return; // pause animation while blurred/hidden; state is already persisted
    const clamped = Math.min(dt, 1 / 30);
    tickHolo(clamped); // one shared clock drives every hologram shader
    if (this.view) {
      this.view.revealConsequences = !this.consequencesHidden();
      this.view.update(clamped, camera);
    }
    this.trackInput(clamped);
    // Panels repaint at most at ~10 Hz, and only when something they show may have changed
    // (plus a 1 Hz safety refresh), so idle frames build no view models and upload no textures.
    this.uiClock += clamped;
    this.uiRefresh += clamped;
    if (this.uiClock >= 0.1 && (this.ui.dirty || this.uiRefresh >= 1)) {
      this.uiClock = 0;
      this.uiRefresh = 0;
      this.ui.render(this.captionModel(), this.openEvidence());
    }
  }

  /**
   * Return the stage to the desk spot remembered from an earlier session once the persistent
   * anchor is back, or remember a new desk placement once there is an anchor to remember it by.
   */
  private rememberDesk(): void {
    if (!this.anchors || !this.world.session || !this.backdrop.passthroughAvailable || this.needsRecenter) return;
    if (!this.recallSettled && this.sessionAge < RECALL_WINDOW && this.deskMemory.recall(this.anchors, this.recalled)) {
      const r = this.recalled;
      this.anchor.position.set(r.x, r.y, r.z);
      this.anchor.rotation.set(0, r.yaw, 0);
      this.placedOn = 'remembered';
      this.ui.setFloor(STAGE_Y);
      this.measureEye();
      this.hands.gestures.reset();
      this.recallSettled = true;
      this.pendingSave = false;
      if (this.debug.enabled) console.info('[explode:room] remembered desk spot');
      return;
    }
    if (this.pendingSave && this.deskMemory.save(this.anchors, { x: this.anchor.position.x, y: this.anchor.position.y, z: this.anchor.position.z, yaw: this.anchor.rotation.y })) {
      this.pendingSave = false;
      this.recallSettled = true; // this session's spot is now the remembered one; never "recall" it
      if (this.debug.enabled) console.info('[explode:room] desk spot saved');
    }
  }

  /** Wide (Quest 3S) ⇄ narrow (glasses-class field of view), remembered between visits. */
  private toggleLayout(): void {
    const next: LayoutMode = this.ui.layout === 'wide' ? 'narrow' : 'wide';
    this.ui.setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Storage unavailable: the layout holds for this visit only.
    }
  }

  /** Tell the UI (and the debug mask) where the eye is now, in the anchor's frame. */
  private measureEye(): void {
    this.anchor.updateMatrixWorld(true);
    this.world.camera.getWorldPosition(this.eyeLocal);
    this.anchor.worldToLocal(this.eyeLocal);
    this.ui.setEye(this.eyeLocal);
    this.fovMask.update(this.eyeLocal);
  }

  /** Recenter asked for by the viewer: it re-picks the desk and replaces any remembered spot. */
  private recenterByUser(): void {
    this.recallSettled = true;
    this.requestRecenter();
  }

  private uiClock = 1;
  private uiRefresh = 0;
  private noInputFor = 0;
  private noInputHint = false;

  /** Hand tracking can be off or the hands out of view; say so instead of looking frozen. */
  private trackInput(dt: number): void {
    const sources = this.world.session?.inputSources;
    this.noInputFor = sources && sources.length === 0 ? this.noInputFor + dt : 0;
    const hint = this.noInputFor >= NO_INPUT_HINT_AFTER;
    if (hint !== this.noInputHint) {
      this.noInputHint = hint;
      this.ui.dirty = true;
    }
  }

  // ---------------------------------------------------------------- systems

  private loadSystem(systemId: string, restore = true): void {
    this.view?.dispose();
    this.store.load(systemId, undefined, restore);
    this.tutorAnswer = null;
    this.view = new GraphView(
      this.world,
      this.store,
      {
        onNodePressed: (id) => this.onNodePressed(id),
        onPlugPressed: (edgeId) => this.dispatch({ type: 'unplug', edge_id: edgeId }),
        onSocketPressed: (edgeId, targetId) => this.dispatch({ type: 'plug', edge_id: edgeId, target_id: targetId }),
      },
      this.anchorEntity,
    );
    this.view.displayFactor = this.store.state.explode_factor;
    this.hands.gestures.reset();
    this.cascadePlayedFor = this.store.state.broken_edge_ids[0] ?? null; // a restored break is not news
    this.lessonWasComplete = this.store.state.lesson?.status === 'complete';
    // Progress saved before finished lessons were recorded still counts.
    const restored = this.store.state.lesson;
    if (restored?.status === 'complete' && !this.done.has(restored.lesson_id)) {
      Store.markDone(restored.lesson_id);
      this.done.add(restored.lesson_id);
    }
    this.sfx.hum(false);
    this.sfx.boot(this.modelAt());
    // ZXY: spin about the model's vertical, then tilt, then roll about the viewer's line of sight.
    this.view.root.rotation.order = 'ZXY';
    this.applyViewPose(Infinity);
  }

  /**
   * Ease the model toward where the hand gestures (or their key equivalents) have put it. Only
   * the model moves; the caption, toolbar and evidence panel stay on the anchor.
   */
  private applyViewPose(dt: number): void {
    const root = this.view?.root;
    if (!root) return;
    const pose = this.hands.pose;
    const a = 1 - Math.exp(-dt * VIEW_EASE);
    root.position.x += (pose.x - root.position.x) * a;
    root.position.y += (pose.y - root.position.y) * a;
    root.position.z += (pose.z - root.position.z) * a;
    const turn = Math.atan2(Math.sin(pose.yaw - root.rotation.y), Math.cos(pose.yaw - root.rotation.y)); // the short way round
    root.rotation.y += turn * a;
    root.rotation.x += (pose.pitch - root.rotation.x) * a;
    const roll = Math.atan2(Math.sin(pose.roll - root.rotation.z), Math.cos(pose.roll - root.rotation.z));
    root.rotation.z += roll * a;
    root.scale.setScalar(root.scale.x + (pose.zoom - root.scale.x) * a);
  }

  private get opening(): ContentBundle {
    return this.tutorials[0]!;
  }

  private get onMechanical(): boolean {
    return this.store.systemId !== this.software.graph.system_id;
  }

  /** Tutorial ⇄ software. From the software system it goes back to the opening tutorial. */
  private switchSystem(): void {
    this.sfx.collapse(this.modelAt());
    this.loadSystem(this.onMechanical ? this.software.graph.system_id : this.opening.graph.system_id);
  }

  /** The tutorial that "More" opens next: the one after the current tutorial, or the second when on software. */
  private moreTarget(): ContentBundle | null {
    if (this.tutorials.length < 2) return null;
    const i = this.tutorials.findIndex((b) => b.graph.system_id === this.store.systemId);
    return this.tutorials[i < 0 ? 1 : (i + 1) % this.tutorials.length]!;
  }

  private openMore(): void {
    const target = this.moreTarget();
    if (!target) return;
    this.sfx.collapse(this.modelAt());
    this.loadSystem(target.graph.system_id);
  }

  /**
   * Sounds that follow state rather than one event: the hum of a traced, intact flow; the
   * failure spreading part by part once its consequence is shown; the lesson's last chime.
   */
  private syncSound(): void {
    const s = this.store.state;
    this.sfx.hum(s.active_path_id !== null && s.broken_edge_ids.length === 0, this.modelAt());
    const c = s.consequences[0];
    if (!c) this.cascadePlayedFor = null;
    else if (c.edge_id !== this.cascadePlayedFor && !this.consequencesHidden()) {
      this.cascadePlayedFor = c.edge_id;
      const points: At[] = [];
      for (const id of c.affected_ids) {
        const p = this.nodeAt(id);
        if (p) points.push(p);
      }
      this.sfx.cascade(points);
    }
    const complete = s.lesson?.status === 'complete';
    if (complete && !this.lessonWasComplete) {
      this.sfx.complete();
      if (s.lesson) {
        Store.markDone(s.lesson.lesson_id);
        this.done.add(s.lesson.lesson_id);
        this.ui.dirty = true;
      }
    }
    this.lessonWasComplete = complete;
  }

  /** True when this bundle's first lesson has been finished before, on this device. */
  private doneBefore(b: ContentBundle): boolean {
    const id = b.lessons[0]?.id;
    return !!id && this.done.has(id);
  }

  /** Finished lessons, read once and kept in step with Store.markDone (no storage reads per frame). */
  private readonly done = Store.doneLessons();

  /** Where a part is right now, for placing its sound (allocates; events only). */
  private nodeAt(id: string | null | undefined): At | null {
    if (!id || !this.view) return null;
    const p = this.view.nodeWorldPosition(id, this.soundTmp);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /** The model's centre, for sounds of the whole model (allocates; events only). */
  private modelAt(): At | null {
    if (!this.view) return null;
    const p = this.view.root.getWorldPosition(this.soundTmp);
    return { x: p.x, y: p.y, z: p.z };
  }

  private readonly soundTmp = new Vector3();

  /**
   * Dim the real room while the headset model's camera link is cut and its consequence is shown.
   * Not during the prediction step: dimming then would give the answer away.
   */
  private syncRoomDim(): void {
    const s = this.store.state;
    const dim =
      !!this.world.session &&
      this.backdrop.passthroughAvailable &&
      this.store.systemId === ROOM_LINK.system &&
      s.broken_edge_ids.includes(ROOM_LINK.edge) &&
      !this.consequencesHidden();
    if (dim === this.roomDimmed) return;
    this.roomDimmed = dim;
    this.backdrop.illustrate(dim);
    this.sfx.dim(dim);
    this.ui.dirty = true;
  }

  // ---------------------------------------------------------------- input

  private dispatch(event: EngineEvent): void {
    this.store.dispatch(event);
  }

  /**
   * True while what a cut stops must stay hidden: during a prediction step, and in an incident
   * drill (a lesson that starts broken) until the learner has made their diagnosis.
   */
  private consequencesHidden(): boolean {
    if (this.predicting()) return true;
    const s = this.store.state;
    return !!currentLesson(this.store.ctx, s)?.starts_broken && s.lesson?.status === 'active' && s.prediction === null;
  }

  /** The lesson after the current one in this system's bundle, if any (the codebase's incident drill). */
  private nextLesson(): { id: string } | null {
    const lessons = this.store.ctx.bundle.lessons;
    const i = lessons.findIndex((l) => l.id === this.store.state.lesson?.lesson_id);
    return i >= 0 ? (lessons[i + 1] ?? null) : null;
  }

  private predicting(): boolean {
    return currentStep(this.store.ctx, this.store.state)?.expect.type === 'predict';
  }

  private onNodePressed(id: string): void {
    if (this.predicting()) {
      this.dispatch({ type: 'predict', target_id: id });
      return;
    }
    const socketEdge = this.view?.socketEdgeFor(id);
    if (socketEdge) {
      this.dispatch({ type: 'plug', edge_id: socketEdge, target_id: id });
      return;
    }
    this.dispatch({ type: 'select', target_id: this.store.state.selected_id === id ? null : id });
  }

  private onEvent(event: EngineEvent | null): void {
    // With the debug readout on, every accepted event is logged so a run can be followed from
    // the console (chrome://inspect on the headset, or the emulator's log capture).
    if (this.debug.enabled) console.info('[explode]', event ? JSON.stringify(event) : 'replay', '→', this.stepKey());
    if (!event) return;
    switch (event.type) {
      case 'set_explode':
        if (event.factor > 0.5) this.sfx.explode(this.modelAt());
        else this.sfx.collapse(this.modelAt());
        break;
      case 'unplug':
        this.sfx.unplug(this.nodeAt(this.store.ctx.edges.get(event.edge_id)?.target_id));
        break;
      case 'plug':
        if (this.store.state.broken_edge_ids.includes(event.edge_id)) this.sfx.reject(this.nodeAt(event.target_id));
        else this.sfx.repair(this.nodeAt(event.target_id));
        break;
      case 'select':
      case 'predict':
        this.sfx.click(this.nodeAt(event.target_id));
        break;
      default:
        this.sfx.click();
    }
    const key = this.stepKey();
    if (key !== this.lastStepKey) {
      this.lastStepKey = key;
      if (this.store.state.lesson?.status !== 'complete') this.sfx.step();
    }
  }

  private async askTutor(trigger: TutorTrigger): Promise<void> {
    const stepKey = this.stepKey();
    const answer = await this.tutor.ask(this.store, trigger, this.liveAllowed);
    this.tutorAnswer = { ...answer, stepKey };
    this.ui.dirty = true;
    for (const action of answer.plan.actions) this.dispatch({ type: 'apply_action', origin: 'tutor', action });
  }

  private onKey(e: KeyboardEvent): void {
    // Desktop / emulator shortcuts; every one has an in-world button.
    const k = e.key.toLowerCase();
    if (k === 'e') this.dispatch({ type: 'set_explode', factor: this.store.state.explode_factor > 0.5 ? 0 : 1 });
    else if (k === 'n') this.next();
    else if (k === 't') this.trace();
    else if (k === 'u') this.store.undo();
    else if (k === 'r') this.store.restart();
    else if (k === 'x') void this.askTutor('explain_selection');
    else if (k === 'c') this.recenterByUser();
    // Equivalents of the hand gestures that move the model (Recenter resets them).
    else if (k === '=' || k === '+') this.hands.gestures.zoomBy(1.25);
    else if (k === '-') this.hands.gestures.zoomBy(0.8);
    else if (k === '[') this.hands.gestures.turnBy(Math.PI / 12);
    else if (k === ']') this.hands.gestures.turnBy(-Math.PI / 12);
    else if (k === ',') this.hands.gestures.rollBy(Math.PI / 12);
    else if (k === '.') this.hands.gestures.rollBy(-Math.PI / 12);
    else if (k === 'pageup') this.hands.gestures.tiltBy(-Math.PI / 12);
    else if (k === 'pagedown') this.hands.gestures.tiltBy(Math.PI / 12);
    else if (k === 'g') this.ui.toggleGuide();
    else if (k === 'l') this.toggleLayout();
    else if (k === 'f') this.fovMask.group.visible = !this.fovMask.group.visible; // testing: show the FoV budgets
    else if (k === 'arrowleft') this.hands.gestures.panBy(-0.05, 0, 0);
    else if (k === 'arrowright') this.hands.gestures.panBy(0.05, 0, 0);
    else if (k === 'arrowup') this.hands.gestures.panBy(0, 0.05, 0);
    else if (k === 'arrowdown') this.hands.gestures.panBy(0, -0.05, 0);
    else if (k === 'd') this.debug.enabled = !this.debug.enabled;
    else if (k === 'p') this.logTargets();
    else if (k === '0') this.forgetProgress();
    else if (k === 's') this.switchSystem();
    else if (k === 'm') this.openMore();
    else if (k === 'v') this.world.launchXR({ sessionMode: SessionMode.ImmersiveVR }); // testing: the VR fallback path
  }

  /**
   * Print where every pressable thing is right now, in world space. The emulator walkthrough
   * (scripts/walkthrough.ts) aims its rays from this, so it follows any layout change.
   */
  private logTargets(): void {
    const info = this.world.renderer.info;
    // Draw calls and triangles of the last rendered frame. Outside a session this is the app's
    // own content; inside the emulator it also counts the emulated room and controllers.
    const perf = info ? { draws: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures } : null;
    const targets = { step: this.stepKey(), backdrop: this.backdrop.mode, placedOn: this.placedOn, planes: this.room?.planeCount ?? 0, perf, view: { ...this.hands.pose, mode: this.hands.gestures.mode }, buttons: this.ui.buttonPositions(this.tmp), ...this.view?.targetPositions(this.tmp) };
    console.info('[explode:targets]', JSON.stringify(targets));
  }

  /** Testing only: forget saved progress in both systems and start again at the tutorial. */
  private forgetProgress(): void {
    Store.clearSaved();
    this.done.clear();
    DeskMemory.forget();
    this.loadSystem(this.opening.graph.system_id, false);
    this.recenterByUser(); // a forgotten spot must not keep the stage: place it afresh
  }

  private next(): void {
    const s = this.store.state;
    if (s.lesson && s.lesson.status !== 'active') {
      if (this.onMechanical) this.switchSystem();
      else {
        const following = this.nextLesson();
        if (following) {
          this.sfx.collapse(this.modelAt());
          this.store.restart(following.id);
        }
      }
      return;
    }
    this.dispatch({ type: 'next' });
  }

  private trace(): void {
    const path = this.store.ctx.bundle.graph.paths[0];
    if (path) this.dispatch({ type: 'trace', path_id: path.id });
  }

  private buttons(): ButtonDef[] {
    const st = () => this.store.state;
    const step = () => currentStep(this.store.ctx, st());
    const lessonDone = () => !!st().lesson && st().lesson!.status !== 'active';
    return [
      {
        id: 'next',
        label: () => (lessonDone() ? (this.onMechanical ? 'Continue: software ▸' : this.nextLesson() ? 'Incident drill ▸' : 'Lesson done') : 'Next ▸'),
        enabled: () => (lessonDone() ? this.onMechanical || this.nextLesson() !== null : step()?.expect.type === 'next'),
        primary: () => lessonDone() || step()?.expect.type === 'next',
        onPress: () => this.next(),
      },
      {
        id: 'explode',
        label: () => (st().explode_factor > 0.5 ? 'Collapse' : 'Explode'),
        enabled: () => true,
        primary: () => {
          const x = step()?.expect;
          return x?.type === 'explode_at_least' || x?.type === 'collapse_below';
        },
        onPress: () => this.dispatch({ type: 'set_explode', factor: st().explode_factor > 0.5 ? 0 : 1 }),
      },
      {
        id: 'trace',
        label: () => `Trace ${this.store.ctx.bundle.graph.paths[0]?.label ?? ''}`.trim(),
        enabled: () => this.store.ctx.bundle.graph.paths.length > 0,
        primary: () => step()?.expect.type === 'trace',
        onPress: () => this.trace(),
      },
      {
        id: 'evidence',
        label: () => 'Evidence',
        enabled: () => this.evidenceForContext() !== null,
        primary: () => step()?.expect.type === 'open_evidence',
        onPress: () => this.dispatch({ type: 'open_evidence', evidence_id: this.evidenceForContext() }),
      },
      { id: 'explain', label: () => 'Explain this', enabled: () => st().selected_id !== null, onPress: () => void this.askTutor('explain_selection') },
      { id: 'depends', label: () => 'What depends?', enabled: () => st().selected_id !== null, onPress: () => void this.askTutor('what_depends') },
      { id: 'why', label: () => 'Why it failed', enabled: () => st().broken_edge_ids.length > 0, onPress: () => void this.askTutor('why_failed') },
      { id: 'hint', label: () => 'Hint', enabled: () => step() !== null, onPress: () => void this.askTutor('hint') },
      { id: 'undo', label: () => 'Undo', enabled: () => this.store.log.length > 0, onPress: () => this.store.undo() },
      { id: 'reset', label: () => 'Reset', enabled: () => true, onPress: () => this.store.restart() },
      { id: 'recenter', label: () => 'Recenter', enabled: () => true, onPress: () => this.recenterByUser() },
      { id: 'guide', label: () => (this.ui.guideVisible ? 'Hide gestures' : 'Gestures'), enabled: () => true, onPress: () => this.ui.toggleGuide() },
      { id: 'sound', label: () => `Sound: ${this.sfx.level}`, enabled: () => true, onPress: () => this.sfx.cycleLevel() },
      { id: 'layout', label: () => `Layout: ${this.ui.layout}`, enabled: () => true, onPress: () => this.toggleLayout() },
      { id: 'backdrop', label: () => `View: ${this.backdrop.mode}`, enabled: () => this.backdrop.passthroughAvailable, onPress: () => this.backdrop.cycle() },
      {
        id: 'switch',
        label: () => (this.onMechanical ? (lessonDone() || this.doneBefore(this.store.ctx.bundle) ? 'Software ▸' : 'Skip tutorial') : `◂ ${shortName(this.opening)}`),
        enabled: () => true,
        onPress: () => this.switchSystem(),
      },
      {
        id: 'more',
        label: () => {
          const t = this.moreTarget();
          return t ? `More: ${shortName(t)}${this.doneBefore(t) ? ' ✓' : ''}` : 'More: n/a';
        },
        enabled: () => this.moreTarget() !== null,
        onPress: () => this.openMore(),
      },
      {
        id: 'live',
        label: () => (this.tutor.liveConfigured ? `Live AI: ${this.liveAllowed ? 'on' : 'off'}` : 'Live AI: n/a'),
        enabled: () => this.tutor.liveConfigured,
        onPress: () => (this.liveAllowed = !this.liveAllowed),
      },
    ];
  }

  // ---------------------------------------------------------------- view models

  private stepKey(): string {
    const l = this.store.state.lesson;
    return `${this.store.systemId}:${l?.lesson_id}:${l?.step_index}:${l?.status}`;
  }

  private evidenceForContext(): string | null {
    const s = this.store.state;
    const c = s.consequences[0];
    if (c?.evidence_ids[0]) return c.evidence_ids[0];
    if (s.selected_id) return this.store.ctx.nodes.get(s.selected_id)?.evidence_ids[0] ?? null;
    if (s.active_path_id) return this.store.ctx.paths.get(s.active_path_id)?.evidence_ids[0] ?? null;
    return null;
  }

  private openEvidence(): Evidence | null {
    const id = this.store.state.evidence_open_id;
    return id ? (this.store.ctx.evidence.get(id) ?? null) : null;
  }

  private captionModel(): CaptionModel {
    const s = this.store.state;
    const lesson = currentLesson(this.store.ctx, s);
    const step = currentStep(this.store.ctx, s);
    const labelOf = (id: string) => this.store.ctx.nodes.get(id)?.label ?? id;
    let caption: string;
    if (step) caption = step.caption;
    else if (s.lesson?.status === 'complete')
      caption = this.onMechanical
        ? 'Tutorial complete. Same gestures, different world: continue to the software system.'
        : this.nextLesson()
          ? 'Lesson complete. Ready for an incident? Press Incident drill: something will be broken, and only the symptom will tell you where.'
          : 'Lesson complete. Explore freely: drag a part to move it, drag empty space to turn it, hold it with both hands to zoom and rotate. Gestures lists them all.';
    else caption = 'Free exploration. Drag a part to move it, drag empty space to turn it, hold it with both hands to zoom and rotate.';
    const tutor = this.tutorAnswer && this.tutorAnswer.stepKey === this.stepKey() ? this.tutorAnswer : null;
    const graph = this.store.ctx.bundle.graph;
    return {
      title: lesson?.title ?? graph.display_name,
      progress:
        lesson && s.lesson?.status === 'active'
          ? `${s.lesson.step_index + 1}/${lesson.steps.length}${this.done.has(s.lesson.lesson_id) ? ' · done before' : ''}`
          : '',
      caption,
      question: s.question,
      feedback: s.feedback,
      annotation: s.annotation ? `▸ ${labelOf(s.annotation.target_id)}: ${s.annotation.text}` : null,
      tutor: tutor ? { say: tutor.plan.say, status: tutor.plan.claim_status, source: tutor.source } : null,
      note: this.noInputHint ? NO_INPUT_HINT : this.roomDimmed ? ROOM_DIM_NOTE : (tutor?.note ?? null),
      consequence: this.consequencesHidden() ? null : consequenceText(s, labelOf),
    };
  }

  // ---------------------------------------------------------------- comfort

  /**
   * Place the system facing the viewer, yaw only: with its stage standing on the desk in front
   * of them when the headset has detected one, otherwise in front of and slightly below the eyes.
   */
  private tryRecenter(): void {
    if (this.recenterWait > 0) {
      this.recenterWait--;
      return;
    }
    const camera = this.world.camera;
    camera.getWorldPosition(this.tmp);
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const v = this.viewer;
    v.x = this.tmp.x;
    v.y = this.tmp.y;
    v.z = this.tmp.z;
    v.fx = this.fwd.x;
    v.fz = this.fwd.z;
    // Only a mixed-reality session has a real desk to stand on; the 2D page and the virtual
    // backdrop keep the floating placement.
    if (this.world.session && this.backdrop.passthroughAvailable && this.room?.pickDesk(v, this.desk)) {
      this.anchor.position.set(this.desk.x, this.desk.y - STAGE_Y + DESK_CLEARANCE, this.desk.z);
      this.placedOn = 'desk';
      this.pendingSave = true; // remembered once the anchor is there (rememberDesk)
    } else {
      this.anchor.position.copy(this.tmp).addScaledVector(this.fwd, ANCHOR_DISTANCE);
      this.anchor.position.y -= ANCHOR_DROP;
      this.placedOn = 'air';
      this.pendingSave = false;
    }
    // On a desk nothing may sit below the surface, so the toolbar and gesture card rise onto it.
    this.ui.setFloor(this.placedOn === 'desk' ? STAGE_Y : null);
    if (this.debug.enabled) {
      console.info('[explode:room]', this.placedOn, 'planes', this.room?.planeCount ?? 0, 'eye', v.y.toFixed(2));
      if (this.room) console.info('[explode:surfaces]', JSON.stringify(this.room.describe()));
    }
    this.anchor.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
    this.measureEye();
    this.hands.gestures.reset(); // Recenter also undoes any move, zoom or turn of the model
    this.needsRecenter = false;
    if (this.world.session) this.recenteredInXR = true;
  }
}

/** A button-sized name: the last word of the display name before its qualifier ("… headset (teaching model)" → "Headset"). */
function shortName(b: ContentBundle): string {
  const word = b.graph.display_name.replace(/\s*\(.*\)\s*$/, '').split(/\s+/).pop() ?? '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function readLayout(): LayoutMode {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'narrow' ? 'narrow' : 'wide';
  } catch {
    return 'wide';
  }
}

let app: ExplodeApp | null = null;

export function startApp(
  world: World,
  bundles: ContentBundle[],
  tutorUrl: string | null,
  debug = false,
  room: RoomSystem | null = null,
  anchors: (AnchorFrame & { tick?(): void }) | null = null,
): ExplodeApp {
  app = new ExplodeApp(world, bundles, tutorUrl, debug, room, anchors);
  world.registerSystem(AppSystem);
  world.renderer.xr.addEventListener('sessionstart', () => app?.onSessionChange(true));
  world.renderer.xr.addEventListener('sessionend', () => app?.onSessionChange(false));
  return app;
}

class AppSystem extends createSystem({}) {
  update(delta: number): void {
    app?.update(delta);
  }
}
