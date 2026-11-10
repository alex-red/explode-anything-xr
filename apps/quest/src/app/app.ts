import { createSystem, Group, SessionMode, Vector3, VisibilityState, type Entity, type World } from '@iwsdk/core';
import type { ContentBundle, EngineEvent, Evidence, TutorTrigger } from '@explode/contracts';
import { currentLesson, currentStep } from '@explode/lesson-engine';
import { Sfx } from './audio.ts';
import { Backdrop } from './backdrop.ts';
import { DebugReadout } from './debug-readout.ts';
import { GraphView } from './graph-view.ts';
import { Store } from './store.ts';
import { TutorClient, type TutorAnswer } from './tutor-client.ts';
import { TwoHandPull } from './two-hand-pull.ts';
import { consequenceText, SpatialUI, type ButtonDef, type CaptionModel } from './ui.ts';

const ANCHOR_DISTANCE = 0.7; // m in front of the eyes; nearest parts stay within seated reach
const ANCHOR_DROP = 0.14; // m below eye level, so the object sits above the hands
const SESSION_START_SETTLE_FRAMES = 10; // frames to wait for a real head pose before recentering
const NO_INPUT_HINT_AFTER = 3; // s in a session with no hand or controller before the hint shows
const NO_INPUT_HINT = "I can't see your hands. Hold them up in view, or pick up a controller.";

/** Top-level controller: owns the store, view, UI, tutor, and input glue. */
export class ExplodeApp {
  private readonly store: Store;
  private readonly anchor = new Group();
  private readonly anchorEntity: Entity;
  private view: GraphView | null = null;
  private readonly ui: SpatialUI;
  private readonly tutor: TutorClient;
  private readonly pull: TwoHandPull;
  private readonly backdrop: Backdrop;
  private readonly debug: DebugReadout;
  private readonly sfx = new Sfx();
  private readonly software: ContentBundle;
  private readonly mechanical: ContentBundle;
  private tutorAnswer: (TutorAnswer & { stepKey: string }) | null = null;
  private liveAllowed = true;
  private paused = false;
  private needsRecenter = true;
  private lastStepKey = '';
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();

  constructor(
    private readonly world: World,
    bundles: ContentBundle[],
    tutorUrl: string | null,
    debug = false,
  ) {
    const software = bundles.find((b) => b.graph.system_kind === 'software');
    const mechanical = bundles.find((b) => b.graph.system_kind === 'mechanical');
    if (!software || !mechanical) throw new Error('expected one software and one mechanical bundle');
    this.software = software;
    this.mechanical = mechanical;
    this.store = new Store(new Map(bundles.map((b) => [b.graph.system_id, b])));
    this.tutor = new TutorClient(tutorUrl);
    this.anchorEntity = world.createTransformEntity(this.anchor);
    this.backdrop = new Backdrop(world);
    this.debug = new DebugReadout(world, this.anchorEntity);
    this.debug.enabled = debug;
    this.ui = new SpatialUI(world, this.anchorEntity, this.buttons(), () => this.dispatch({ type: 'open_evidence', evidence_id: null }));
    this.pull = new TwoHandPull(
      world,
      () => this.store.state.explode_factor,
      (f) => {
        if (this.view) this.view.pullPreview = f;
      },
      (f) => this.dispatch({ type: 'set_explode', factor: f }),
    );

    this.store.subscribe((_, event) => {
      this.ui.dirty = true;
      this.onEvent(event);
    });
    const last = Store.lastActiveSystem();
    this.loadSystem(last && [software.graph.system_id, mechanical.graph.system_id].includes(last) ? last : mechanical.graph.system_id);

    world.visibilityState.subscribe((v) => {
      this.paused = v === VisibilityState.Hidden || v === VisibilityState.VisibleBlurred;
      if (v === VisibilityState.Hidden) this.sfx.suspend();
      if (v === VisibilityState.Visible) this.needsRecenter ||= !this.recenteredInXR;
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private recenteredInXR = false;

  private recenterWait = 0;

  /** A session started or ended: pick the backdrop it needs and re-place the system. */
  onSessionChange(active: boolean): void {
    if (active) this.backdrop.onSessionStart(this.world.renderer.xr.getSession()?.environmentBlendMode);
    else this.backdrop.onSessionEnd();
    this.ui.dirty = true;
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
    if (this.needsRecenter) this.tryRecenter();
    this.backdrop.update(camera);
    this.pull.update();
    this.debug.update(dt);
    if (this.paused) return; // pause animation while blurred/hidden; state is already persisted
    const clamped = Math.min(dt, 1 / 30);
    if (this.view) {
      this.view.revealConsequences = !this.predicting();
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
  }

  private get onMechanical(): boolean {
    return this.store.systemId === this.mechanical.graph.system_id;
  }

  private switchSystem(): void {
    this.sfx.collapse();
    this.loadSystem(this.onMechanical ? this.software.graph.system_id : this.mechanical.graph.system_id);
  }

  // ---------------------------------------------------------------- input

  private dispatch(event: EngineEvent): void {
    this.store.dispatch(event);
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
        if (event.factor > 0.5) this.sfx.explode();
        else this.sfx.collapse();
        break;
      case 'unplug':
        this.sfx.unplug();
        break;
      case 'plug':
        if (this.store.state.broken_edge_ids.includes(event.edge_id)) this.sfx.reject();
        else this.sfx.plug();
        break;
      default:
        this.sfx.click();
    }
    const key = this.stepKey();
    if (key !== this.lastStepKey) {
      this.lastStepKey = key;
      this.sfx.step();
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
    else if (k === 'c') this.needsRecenter = true;
    else if (k === 'd') this.debug.enabled = !this.debug.enabled;
    else if (k === 'p') this.logTargets();
    else if (k === '0') this.forgetProgress();
    else if (k === 's') this.switchSystem();
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
    const targets = { step: this.stepKey(), backdrop: this.backdrop.mode, perf, buttons: this.ui.buttonPositions(this.tmp), ...this.view?.targetPositions(this.tmp) };
    console.info('[explode:targets]', JSON.stringify(targets));
  }

  /** Testing only: forget saved progress in both systems and start again at the tutorial. */
  private forgetProgress(): void {
    Store.clearSaved();
    this.loadSystem(this.mechanical.graph.system_id, false);
  }

  private next(): void {
    const s = this.store.state;
    if (s.lesson && s.lesson.status !== 'active') {
      if (this.onMechanical) this.switchSystem();
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
        label: () => (lessonDone() ? (this.onMechanical ? 'Continue: software ▸' : 'Lesson done') : 'Next ▸'),
        enabled: () => (lessonDone() ? this.onMechanical : step()?.expect.type === 'next'),
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
      { id: 'recenter', label: () => 'Recenter', enabled: () => true, onPress: () => (this.needsRecenter = true) },
      { id: 'backdrop', label: () => `View: ${this.backdrop.mode}`, enabled: () => this.backdrop.passthroughAvailable, onPress: () => this.backdrop.cycle() },
      {
        id: 'switch',
        label: () => (this.onMechanical ? (lessonDone() ? 'Software ▸' : 'Skip tutorial') : '◂ Car'),
        enabled: () => true,
        onPress: () => this.switchSystem(),
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
        : 'Lesson complete. Explore freely: select parts, trace, unplug, and ask why. Reset to try again.';
    else caption = 'Free exploration. Select a part, trace a path, or unplug a connection.';
    const tutor = this.tutorAnswer && this.tutorAnswer.stepKey === this.stepKey() ? this.tutorAnswer : null;
    const graph = this.store.ctx.bundle.graph;
    return {
      title: lesson?.title ?? graph.display_name,
      progress: lesson && s.lesson?.status === 'active' ? `${s.lesson.step_index + 1}/${lesson.steps.length}` : '',
      caption,
      question: s.question,
      feedback: s.feedback,
      annotation: s.annotation ? `▸ ${labelOf(s.annotation.target_id)}: ${s.annotation.text}` : null,
      tutor: tutor ? { say: tutor.plan.say, status: tutor.plan.claim_status, source: tutor.source } : null,
      note: this.noInputHint ? NO_INPUT_HINT : (tutor?.note ?? null),
      consequence: this.predicting() ? null : consequenceText(s, labelOf),
    };
  }

  // ---------------------------------------------------------------- comfort

  /** Place the system in front of and slightly below the eyes, facing the viewer, yaw only. */
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
    this.anchor.position.copy(this.tmp).addScaledVector(this.fwd, ANCHOR_DISTANCE);
    this.anchor.position.y -= ANCHOR_DROP;
    this.anchor.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
    this.needsRecenter = false;
    if (this.world.session) this.recenteredInXR = true;
  }
}

let app: ExplodeApp | null = null;

export function startApp(world: World, bundles: ContentBundle[], tutorUrl: string | null, debug = false): ExplodeApp {
  app = new ExplodeApp(world, bundles, tutorUrl, debug);
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
