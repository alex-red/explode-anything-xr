import { createSystem, Group, SessionMode, Vector3, VisibilityState, type Entity, type World } from '@iwsdk/core';
import type { AssistantCommand, ContentBundle, ConversationTurn, EngineEvent, Evidence, TutorTrigger, ViewContext } from '@explode/contracts';
import { MAX_HISTORY_TURNS } from '@explode/contracts';
import { currentLesson, currentStep, DETAIL_LEVELS, stepDetail, visibleAtDetail, type DetailLevel } from '@explode/lesson-engine';
import { AssistantOrb } from './assistant-orb.ts';
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
import { VoiceCapture } from './voice.ts';
import { setInputTrace } from './interactions.ts';
import { tickHolo } from './holo.ts';
import { consequenceText, SpatialUI, type ButtonDef, type CaptionModel } from './ui.ts';
import { NodeMenu, type MenuItem } from './node-menu.ts';
import { repoQueryIn, type ExplodeApi } from './explode-client.ts';
import { ExplodeFlow } from './explode-flow.ts';
import { LoadingView } from './loading-view.ts';
import { ProposalCard, cardButtons } from './proposal-card.ts';
import type { SavedSystems } from './saved-systems.ts';
import { ProjectPicker, type PickerItem } from './project-picker.ts';
import { builtProject, projectsFrom, type LoadProgress, type Project } from './projects.ts';
import { MAX_PICKER_ITEMS } from './project-picker.ts';

const ANCHOR_DISTANCE = 0.7; // m in front of the eyes; nearest parts stay within seated reach
const ANCHOR_DROP = 0.14; // m below eye level, so the object sits above the hands
const DESK_CLEARANCE = 0.005; // m the stage floats above the desk, so it never z-fights the real surface
const LATE_PLANE_WINDOW = 3; // s after a session starts in which a newly reported desk still moves the stage
const RECALL_WINDOW = 6; // s after a session starts in which a restored anchor still returns the stage to its remembered spot
const SESSION_START_SETTLE_FRAMES = 10; // frames to wait for a real head pose before recentering
const VIEW_EASE = 18; // 1/s: how fast the model follows a hand gesture; high enough to feel held
const LAYOUT_KEY = 'explode:layout:v1';
const DETAIL_KEY = 'explode:detail:v1';
/** What the codebase opens on: key and supporting parts, the extras on the shelf (EXPLORE_PLAN W11). */
const DEFAULT_DETAIL: DetailLevel = 'supporting';
/** Button-sized names for the detail levels. */
const DETAIL_NAME: Record<DetailLevel, string> = { key: 'key', supporting: 'more', all: 'all' };
const NO_INPUT_HINT_AFTER = 3; // s in a session with no hand or controller before the hint shows
const NO_INPUT_HINT = "I can't see your hands. Hold them up in view, or pick up a controller.";
/**
 * Why the stage floats in mixed reality, shown until the learner's first action (DEMO_PLAN C4).
 * The headset reported no room at all: most often Space Setup was never run, or the browser was
 * not allowed the room. Or it reported a room with no table in seated reach.
 */
const FLOAT_NO_ROOM = 'No room setup was found, so the model floats in front of you. To stand it on your desk, add the desk in your headset\'s Space Setup, then press Recenter.';
const FLOAT_NO_DESK = 'No table within reach, so the model floats in front of you. Sit at a table and press Recenter to stand it there.';
/**
 * The headset lesson's break: cutting the camera link dims the real room (WIN_PLAN W3). It is an
 * illustration of what the link carries, said so at the moment it happens; the headset is not
 * changed, and the user's real hand tracking keeps working.
 */
const ROOM_LINK = { system: 'system:mr-headset', edge: 'edge:transmits:part:cameras->part:board' };
const ROOM_DIM_NOTE = 'We dimmed your view of the room to show what this link carries. Your headset is fine, and your hands still work.';

/** Seconds the loading dial stays up at least once it has had to appear, so it reads as a moment, not a flicker. */
const MIN_LOADER_SECONDS = 0.6;
/** Seconds a failed load is shown on the dial before the previous project comes back. */
const FAILED_LOAD_SECONDS = 2.6;

/**
 * A change of project in flight: the old model leaves, the new bundle loads (when it is not in
 * hand yet) with the dial up, then the new model boots on the stage.
 */
interface ProjectSwitch {
  project: Project;
  restore: boolean;
  /** The system to come back to if the load fails. */
  from: string;
  phase: 'leave' | 'load' | 'failed';
  /** Seconds in the current phase. */
  t: number;
  ready: boolean;
  /** Its bundle was not in hand when the change began: the dial comes up, however fast the download. */
  fetched: boolean;
  error: string | null;
}

/** The picker row that starts Explode Anything; not a project id. */
const EXPLODE_ROW = 'action:explode-anything';
/** The proposal card's two buttons, listed for the assistant like every other button; the card draws them itself. */
const CARD_BUTTONS = new Set(['build-system', 'cancel-build']);
const EXPLODE_HOW_2D = 'Type a GitHub address (github.com/owner/name), or the name of something to draft (Mars, a bicycle), in the Explode box on this page.';
const EXPLODE_HOW_VOICE = 'Press Ask and say what to explode, for example "explode Mars" or "explode github.com/honojs/hono". You will see a proposal before anything is built.';

/** What Explode Anything needs from outside the app (ADR-0026). Absent: only shipped systems exist. */
export interface ExplodeDeps {
  api: ExplodeApi;
  saved: SavedSystems;
  /**
   * When to ask the server again whether it can build, in ms after a "no", one entry per try.
   * A host that sleeps when idle says nothing for a while and then wakes. Default: 15 s, then 45 s.
   */
  retryMs?: readonly number[];
}

const AVAILABILITY_RETRY_MS = [15_000, 45_000] as const;

/**
 * `?speak=0` (and `?capture`) keeps the assistant's answers silent, captions only. A desktop
 * browser reads them aloud and Quest Browser reportedly cannot, so an emulator capture uses this
 * to sound like the headset (docs/DEMO_PLAN.md A3).
 */
const SPEAK_ANSWERS = (() => {
  if (typeof location === 'undefined') return true;
  const q = new URLSearchParams(location.search);
  return q.get('speak') !== '0' && !q.has('capture');
})();
/** `?capture`: log every accepted event (as the debug readout does) without showing the readout, so a recorded take can be cut by its events. */
const LOG_EVENTS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture');

/** Why the assistant is not listening, in the learner's terms. */
const VOICE_NOTE = {
  nothing: "I didn't hear anything. Press Ask and speak; I stop listening when you do.",
  denied: 'The microphone is blocked for this page. Allow it in the browser, or use the buttons.',
  unavailable: 'This browser gave me no microphone. The buttons still do everything.',
} as const;

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
  /** Every system the app can open, loaded or not, in picker order. */
  private readonly projects: Project[];
  private readonly software: Project;
  /** Tutorial systems in the order given; the first is the opening lesson, the rest are under "More". */
  private readonly tutorials: Project[];
  /** Further software systems after the lesson codebase (the real SDK): explored, not broken. */
  private readonly showcases: Project[];
  private readonly picker: ProjectPicker;
  private readonly loading: LoadingView;
  private switching: ProjectSwitch | null = null;
  /** Explode Anything: the conversation about a new system, and the card that shows it. Null without a build server. */
  private readonly flow: ExplodeFlow | null;
  private readonly card: ProposalCard | null;
  private readonly saved: SavedSystems | null;
  /** True once the build server has said it can build. Until then no way in is offered. */
  private explodeAvailable = false;
  /** Resolves to whether new systems can be built here (the 2D page shows its box on true). */
  readonly explodeReady: Promise<boolean>;
  /** A system just built, waiting for a project change in flight to finish before it opens. */
  private pendingOpen: string | null = null;
  /** Told when the learner asks how to explode something new (the 2D page focuses its box). */
  onExplodeAsked: (() => void) | null = null;
  /** Told when the list of projects grows (the 2D page's selector follows it). */
  onProjectsChange: (() => void) | null = null;
  /** Bundles on their way, so a prefetch and an open of the same project share one download. */
  private readonly inFlight = new Map<string, Promise<ContentBundle>>();
  /** The latest progress of each download, read by the dial every frame. */
  private readonly progress = new Map<string, LoadProgress>();
  /** Told whenever the system on the stage changes (the 2D page's project selector follows it). */
  onProjectChange: ((systemId: string) => void) | null = null;
  private roomDimmed = false;
  /** Why the stage floats instead of standing on a desk; cleared by the learner's first action. */
  private floatNote: string | null = null;
  /** The broken edge whose spreading failure has already been played, so it plays once. */
  private cascadePlayedFor: string | null = null;
  private lessonWasComplete = false;
  private tutorAnswer: (TutorAnswer & { stepKey: string }) | null = null;
  private liveAllowed = true;
  /** Every button, kept so the assistant presses exactly what a ray would. */
  private buttonDefs: ButtonDef[] = [];
  /** The last few lines of the conversation with the assistant, for follow-up questions. */
  private readonly history: ConversationTurn[] = [];
  private asking = false;
  /** The assistant's icon. Only with a live tutor: offline it could do nothing, so it is not shown. */
  private readonly orb: AssistantOrb | null;
  private readonly voice = new VoiceCapture();
  /** A spoken question being transcribed and answered. */
  private voiceBusy = false;
  /** What the assistant heard, or why it could not listen; shown under the caption. */
  private voiceNote: string | null = null;
  /** How much of the codebase is shown; per viewer, remembered. Mechanical models always show every part. */
  private detail: DetailLevel = readDetail();
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
    projects: Project[] = projectsFrom(bundles),
    explode: ExplodeDeps | null = null,
  ) {
    // A project that has no loader must have come in already loaded.
    this.projects = projects.filter((p) => p.load || bundles.some((b) => b.graph.system_id === p.id));
    const software = this.projects.find((p) => p.kind === 'software');
    // An AI draft the learner had built is a model too, and is no part of the tutorials.
    const tutorials = this.projects.filter((p) => p.kind === 'mechanical' && !p.built);
    if (!software || tutorials.length === 0) throw new Error('expected one software project and at least one mechanical project');
    if (bundles.length === 0) throw new Error('expected at least one loaded bundle to open on');
    this.software = software;
    this.tutorials = tutorials;
    // Systems the learner had built are in the picker, never on the lesson path.
    this.showcases = this.projects.filter((p) => p.kind === 'software' && p !== software && !p.built);
    this.store = new Store(new Map(bundles.map((b) => [b.graph.system_id, b])));
    this.tutor = new TutorClient(tutorUrl);
    this.anchorEntity = world.createTransformEntity(this.anchor);
    this.backdrop = new Backdrop(world);
    this.debug = new DebugReadout(world, this.anchorEntity);
    this.debug.enabled = debug;
    setInputTrace(debug);
    // While a project is changing nothing presses through to the one that is leaving.
    this.buttonDefs = this.buttons().map((d) => ({ ...d, onPress: () => (this.switching ? undefined : d.onPress()) }));
    this.ui = new SpatialUI(
      world,
      this.anchorEntity,
      this.buttonDefs.filter((d) => !CARD_BUTTONS.has(d.id)),
      () => this.dispatch({ type: 'open_evidence', evidence_id: null }),
      () => this.togglePicker(),
    );
    this.ui.setLayout(readLayout());
    this.menu = new NodeMenu(world, this.anchorEntity);
    this.picker = new ProjectPicker(world, this.anchorEntity, (id) => (id === EXPLODE_ROW ? this.explainExplode() : this.openProject(id)));
    this.saved = explode?.saved ?? null;
    this.flow = explode ? new ExplodeFlow(explode.api, (bundle) => this.onBuilt(bundle), () => this.onFlowChange()) : null;
    this.card = explode ? new ProposalCard(world, this.anchorEntity, (id) => this.pressCard(id)) : null;
    this.explodeReady = explode ? this.askAvailable(explode.api, [...(explode.retryMs ?? AVAILABILITY_RETRY_MS)]) : Promise.resolve(false);
    this.loading = new LoadingView(world, this.anchorEntity);
    this.orb = this.tutor.liveConfigured ? new AssistantOrb(world, this.anchorEntity, () => void this.toggleVoice()) : null;
    this.placeOrb();
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
    // Open on the system used last, else the opening tutorial, else whatever came in loaded.
    const last = Store.lastActiveSystem();
    const start = [last, this.opening.id, bundles[0]!.graph.system_id].find((id) => !!id && this.store.has(id))!;
    this.loadSystem(start);

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
    // A flick on empty space swipes the codebase's extras away, or brings them back (EXPLORE_PLAN W11).
    if (this.hands.gestures.flick !== 0) this.setDetail(stepDetail(this.detail, this.hands.gestures.flick));
    this.applyViewPose(dt);
    this.debug.update(dt);
    this.orb?.update(dt, this.voice.level);
    if (this.paused) return; // pause animation while blurred/hidden; state is already persisted
    const clamped = Math.min(dt, 1 / 30);
    tickHolo(clamped); // one shared clock drives every hologram shader
    if (this.view) {
      this.view.revealConsequences = !this.consequencesHidden();
      this.view.update(clamped, camera);
    }
    this.syncMenu();
    this.picker.update(clamped, this.eyeLocal);
    this.ui.captionHidden = this.picker.isOpen; // a long list's header would stand over the caption's foot
    this.flow?.tick(clamped);
    this.card?.update(this.eyeLocal);
    if (this.pendingOpen && !this.switching) {
      const id = this.pendingOpen;
      this.pendingOpen = null;
      this.openProject(id);
    }
    this.tickSwitch(clamped);
    this.loading.update(clamped, this.eyeLocal);
    this.trackInput(clamped);
    // Panels repaint at most at ~10 Hz, and only when something they show may have changed
    // (plus a 1 Hz safety refresh), so idle frames build no view models and upload no textures.
    this.uiClock += clamped;
    this.uiRefresh += clamped;
    if (this.uiClock >= 0.1 && (this.ui.dirty || this.uiRefresh >= 1)) {
      this.uiClock = 0;
      this.uiRefresh = 0;
      this.ui.render(this.captionModel(), this.openEvidence(), this.store.ctx.bundle.graph.revision.kind);
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
    this.placeOrb();
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Storage unavailable: the layout holds for this visit only.
    }
  }

  /** Show more or fewer of the codebase's parts. A no-op on a mechanical model, and at either end. */
  setDetail(level: DetailLevel): void {
    if (this.onMechanical || level === this.detail) return;
    this.detail = level;
    if (this.view) this.view.detail = level;
    this.sfx.click(this.modelAt());
    this.ui.dirty = true;
    try {
      localStorage.setItem(DETAIL_KEY, level);
    } catch {
      // Storage unavailable: the level holds for this visit only.
    }
  }

  /** Key → more → all → key (the toolbar button and the K key). */
  private cycleDetail(): void {
    const i = DETAIL_LEVELS.indexOf(this.detail);
    this.setDetail(DETAIL_LEVELS[(i + 1) % DETAIL_LEVELS.length]!);
  }

  /** Tell the UI (and the debug mask) where the eye is now, in the anchor's frame. */
  private measureEye(): void {
    this.anchor.updateMatrixWorld(true);
    this.world.camera.getWorldPosition(this.eyeLocal);
    this.anchor.worldToLocal(this.eyeLocal);
    this.ui.setEye(this.eyeLocal);
    this.placeOrb();
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
        onShelfPressed: () => this.setDetail(stepDetail(this.detail, 1)),
      },
      this.anchorEntity,
    );
    this.view.detail = this.detail;
    this.ui.setSubject(...subjectOf(this.store.ctx.bundle));
    this.hands.gestures.flickEnabled = !this.onMechanical;
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
    this.onProjectChange?.(systemId);
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

  private get opening(): Project {
    return this.tutorials[0]!;
  }

  private get onMechanical(): boolean {
    return this.store.ctx.bundle.graph.system_kind === 'mechanical';
  }

  /** The project on the stage. */
  private get here(): Project {
    return this.projects.find((p) => p.id === this.store.systemId)!;
  }

  /** On a software system other than the lesson codebase: the SDK, or one built on request. */
  private get onShowcase(): boolean {
    return this.showcases.some((p) => p.id === this.store.systemId) || !!this.here.built;
  }

  // ---------------------------------------------------------------- changing project

  /** The systems the app can open, in picker order (the 2D page's selector lists these). */
  get projectList(): ReadonlyArray<Pick<Project, 'id' | 'kind' | 'name'>> {
    return this.projects;
  }

  /** The system on the stage, or the one on its way there. */
  get currentProject(): string {
    return this.switching?.project.id ?? this.store.systemId;
  }

  /**
   * Put another project on the stage: the current model leaves, its bundle is fetched if it is
   * not in hand yet (the dial shows how far it has got), and the new model boots in its place.
   * Every way of changing project comes through here: the picker, the toolbar, Next, the
   * assistant, the 2D page. A change already under way is not interrupted.
   */
  openProject(id: string, restore = true): void {
    const project = this.projects.find((p) => p.id === id);
    if (!project || this.switching) return;
    if (id === this.store.systemId && restore) return;
    this.picker.close();
    this.menu.hide();
    this.sfx.collapse(this.modelAt());
    const sw: ProjectSwitch = { project, restore, from: this.store.systemId, phase: 'leave', t: 0, ready: this.store.has(id), fetched: !this.store.has(id), error: null };
    this.switching = sw;
    this.view?.depart();
    this.ui.dirty = true;
    if (sw.ready) return;
    const loading = this.fetchProject(project);
    if (!loading) {
      sw.error = 'It is not part of this build.';
      return;
    }
    loading.then(
      () => (sw.ready = true),
      (err: unknown) => {
        console.error('[explode:load]', err);
        sw.error = navigator.onLine === false ? 'You are offline. Connect, then try again.' : 'Check the connection, then try again.';
      },
    );
  }

  /**
   * Fetch a project's bundle in the background, so opening it later needs no wait (the main
   * lesson path is fetched this way once the first model is up). Errors are left for an open of
   * it to report.
   */
  prefetch(id: string): void {
    const project = this.projects.find((p) => p.id === id);
    if (project) this.fetchProject(project)?.catch(() => {});
  }

  /** Start (or join) the download of a project's bundle; null when it has no loader. */
  private fetchProject(project: Project): Promise<ContentBundle> | null {
    const going = this.inFlight.get(project.id);
    if (going) return going;
    if (!project.load) return null;
    const promise = project
      .load((p) => this.progress.set(project.id, p))
      .then((bundle) => {
        this.store.add(bundle);
        return bundle;
      })
      .finally(() => this.inFlight.delete(project.id));
    this.inFlight.set(project.id, promise);
    return promise;
  }

  /** Move a project change on by one frame. */
  private tickSwitch(dt: number): void {
    const sw = this.switching;
    if (!sw) return;
    sw.t += dt;
    if (sw.phase === 'leave') {
      if (this.view && !this.view.departed) return;
      if (sw.ready && !sw.fetched) return this.arrive(sw);
      // Still on its way: the dial comes up where the model will stand.
      sw.phase = 'load';
      sw.t = 0;
      this.view?.dispose();
      this.view = null;
      this.loading.show(shortTitle(sw.project.name));
    }
    if (sw.phase === 'load') {
      const progress = this.progress.get(sw.project.id);
      if (progress) this.loading.set(progress);
      if (sw.error) {
        sw.phase = 'failed';
        sw.t = 0;
        this.loading.fail(sw.error);
        this.sfx.reject(this.modelAt());
        return;
      }
      if (sw.ready && this.loading.shownFor >= MIN_LOADER_SECONDS) {
        this.loading.set({ phase: 'build', fraction: 1, bytes: 0 });
        this.loading.finish();
        this.arrive(sw);
      }
      return;
    }
    // Failed: after a moment, bring back what was there and say what happened.
    if (sw.t >= FAILED_LOAD_SECONDS) {
      this.loading.finish();
      this.switching = null;
      this.loadSystem(sw.from);
      this.voiceSay(`${shortTitle(sw.project.name)} could not be loaded. ${sw.error ?? ''} Open it again from the nameplate.`.trim());
    }
  }

  private arrive(sw: ProjectSwitch): void {
    this.switching = null;
    this.voiceSay(null);
    this.loadSystem(sw.project.id, sw.restore);
  }

  /** The nameplate (or the Projects button, or P) opens the picker; pressed again it closes. */
  private togglePicker(): void {
    if (this.switching) return;
    this.sfx.click();
    this.menu.hide();
    this.picker.toggle(() => this.pickerItems());
  }

  private pickerItems(): PickerItem[] {
    // Shipped systems first, then the newest built ones that fit, then the row that starts another.
    const room = MAX_PICKER_ITEMS - (this.explodeAvailable ? 1 : 0);
    const shipped = this.projects.filter((p) => !p.built);
    const built = this.projects.filter((p) => p.built).slice(-Math.max(0, room - shipped.length));
    const items: PickerItem[] = [...shipped, ...built].slice(0, room).map((p) => ({
      id: p.id,
      kind: p.built ? builtKind(p) : subjectKind(p),
      name: shortTitle(p.name),
      blurb: p.blurb,
      current: p.id === this.store.systemId,
      done: this.doneBefore(p),
      loaded: this.store.has(p.id),
    }));
    if (this.explodeAvailable) {
      items.push({ id: EXPLODE_ROW, kind: 'NEW', name: 'Explode anything…', blurb: 'A GitHub repository, or a subject drafted by AI', current: false, done: false, loaded: true, action: true });
    }
    return items;
  }

  // ---------------------------------------------------------------- explode anything (ADR-0026)

  /**
   * Ask the server whether it can build, and again after each wait in `waits` while it says no
   * or says nothing (a sleeping host wakes on the first request and answers a later one).
   */
  private async askAvailable(api: ExplodeApi, waits: number[]): Promise<boolean> {
    for (;;) {
      const ok = await api.available();
      if (ok) {
        this.explodeAvailable = true;
        this.ui.dirty = true;
        return true;
      }
      const wait = waits.shift();
      if (wait === undefined) return false;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  /** True when a new system can be proposed here right now. */
  get canPropose(): boolean {
    return this.explodeAvailable && !!this.flow;
  }

  /** What the proposal card says right now; empty when it is closed (tests and the walkthrough). */
  get proposalText(): string {
    return this.card?.text ?? '';
  }

  /**
   * Look up something the app does not ship and put a proposal in front of the learner. Every
   * way of asking comes through here: the 2D page's box, a typed or spoken address, the
   * assistant. It builds nothing; only Build on the card does.
   */
  proposeSystem(query: string, kind?: 'repository' | 'subject'): void {
    const q = query.trim().slice(0, 300);
    if (!q) return;
    // A GitHub address is a repository, and so is anything asked for as one ("the zod repo"),
    // which the server looks up by name. Anything else is a subject for a model to draft.
    const repo = repoQueryIn(q);
    const what = kind ?? (repo || /\b(repo|repos|repository|github|codebase)\b/i.test(q) ? 'repository' : 'subject');
    if (!this.flow || !this.explodeAvailable) return this.voiceSay('Building something new is not available right now. Everything in the project list still works.');
    if (this.flow.busy) return this.voiceSay('One proposal at a time: answer the one in front of you first.');
    this.picker.close();
    this.menu.hide();
    this.voiceSay(null);
    this.sfx.click();
    this.flow.propose({ kind: what, query: what === 'repository' ? (repo ?? q) : q });
  }

  /** Whether a project was built on request in this browser, and so can be removed from it. */
  isBuilt(id: string): boolean {
    return !!this.projects.find((p) => p.id === id)?.built;
  }

  /**
   * Forget a system that was built on request: out of the list, and out of this browser's
   * storage. If it is on the stage, the opening tutorial takes its place. Shipped systems cannot
   * be removed. It can always be built again.
   */
  removeBuilt(id: string): void {
    const at = this.projects.findIndex((p) => p.id === id && p.built);
    if (at === -1 || this.switching) return;
    if (this.store.systemId === id) this.openProject(this.opening.id);
    this.projects.splice(at, 1);
    this.saved?.remove(id).catch((err: unknown) => console.warn('[explode:remove]', err));
    this.picker.close();
    this.onProjectsChange?.();
    this.ui.dirty = true;
  }

  /** The picker's Explode anything row: say how to ask. In a headset there is nothing to type on. */
  private explainExplode(): void {
    this.onExplodeAsked?.();
    this.voiceSay(this.world.session ? (this.orb ? EXPLODE_HOW_VOICE : 'Leave the session to type a GitHub address on the page, then come back.') : EXPLODE_HOW_2D);
  }

  private pressCard(id: 'build' | 'cancel'): void {
    this.sfx.click();
    if (id === 'build') this.flow?.build();
    else this.flow?.cancel();
  }

  private onFlowChange(): void {
    if (!this.flow) return;
    this.card?.show(this.flow.view);
    if (this.flow.view.phase === 'stopped') this.sfx.reject(this.modelAt());
    this.ui.dirty = true;
  }

  /** A build finished and its bundle passed the checks here: keep it, list it, and open it. */
  private onBuilt(bundle: ContentBundle): void {
    const id = bundle.graph.system_id;
    this.store.add(bundle);
    if (!this.projects.some((p) => p.id === id)) this.projects.push(builtProject(bundle));
    // Kept in this browser for next time; if storage refuses, it still opens now.
    this.saved?.save(bundle).catch((err: unknown) => console.warn('[explode:save]', err));
    this.onProjectsChange?.();
    this.pendingOpen = id;
  }

  /** Tutorial ⇄ software. From the software system it goes back to the opening tutorial. */
  private switchSystem(): void {
    this.openProject(this.onMechanical ? this.software.id : this.opening.id);
  }

  /**
   * What "More" opens next. The round goes through the tutorials, then the showcase systems; from
   * the lesson codebase it opens the first thing after the opening tutorial.
   */
  private moreTarget(): Project | null {
    const round = [...this.tutorials, ...this.showcases];
    if (round.length < 2) return null;
    const i = round.findIndex((p) => p.id === this.store.systemId);
    return round[i < 0 ? 1 : (i + 1) % round.length]!;
  }

  private openMore(): void {
    const target = this.moreTarget();
    if (target) this.openProject(target.id);
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
  private doneBefore(p: Project): boolean {
    const id = p.firstLesson;
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
    if (this.switching) return; // the system on the stage is leaving
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

  // ---------------------------------------------------------------- part menu

  private readonly menu: NodeMenu;
  /** The state the open menu was built for; rebuilt when it changes (events only). */
  private menuState: unknown = null;
  /** A part whose menu was used or closed: it stays shut until the selection changes. */
  private menuDismissed: string | null = null;
  private readonly menuAt = new Vector3();

  /** Open the menu beside the selected part, keep it on that part, and shut it when nothing is selected. */
  private syncMenu(): void {
    const s = this.store.state;
    const sel = s.selected_id;
    if (sel !== this.menuDismissed) this.menuDismissed = null;
    const view = this.view;
    const wanted = sel !== null && sel !== this.menuDismissed && !!view && view.isShown(sel) && !this.predicting();
    if (!wanted || !view || sel === null) {
      if (this.menu.openFor !== null) this.menu.hide();
      return;
    }
    const node = this.store.ctx.nodes.get(sel);
    if (!node) return;
    if (this.menu.openFor !== sel || this.menuState !== s) {
      this.menuState = s;
      this.menu.open(sel, node.label, kindLabel(node.kind, this.onMechanical, node.truth_status === 'inferred'), this.menuItems(sel));
    }
    if (!view.nodeWorldPosition(sel, this.menuAt)) return;
    const radius = (this.store.ctx.bundle.layout.placements[sel]?.radius ?? 0.02) * view.root.scale.x;
    this.menu.update(this.anchor, this.menuAt, radius, this.eyeLocal);
  }

  /**
   * What can be done with a part, in the order it is most often wanted. Every option goes through
   * the same handlers as the toolbar; the menu adds no new way to change the lesson.
   */
  private menuItems(id: string): MenuItem[] {
    const s = this.store.state;
    const ctx = this.store.ctx;
    const by = this.tutor.liveConfigured && this.liveAllowed ? 'AI' : 'guide';
    const items: MenuItem[] = [
      { id: 'explain', label: `Explain this (${by})`, onPress: () => this.fromMenu(() => void this.askTutor('explain_selection')) },
      { id: 'depends', label: `What depends on it? (${by})`, onPress: () => this.fromMenu(() => void this.askTutor('what_depends')) },
    ];
    const stopped = !this.consequencesHidden() && s.consequences.some((c) => c.affected_ids.includes(id));
    if (stopped) items.push({ id: 'why', label: `Why did it stop? (${by})`, onPress: () => this.fromMenu(() => void this.askTutor('why_failed')) });
    const evidence = ctx.nodes.get(id)?.evidence_ids[0];
    if (evidence && s.evidence_open_id !== evidence) items.push({ id: 'evidence', label: 'Show its evidence', onPress: () => this.fromMenu(() => this.dispatch({ type: 'open_evidence', evidence_id: evidence })) });
    const path = ctx.bundle.graph.paths.find((p) => p.node_ids.includes(id));
    if (path && s.active_path_id !== path.id) items.push({ id: 'trace', label: `Trace ${path.label}`.slice(0, 40), onPress: () => this.fromMenu(() => this.dispatch({ type: 'trace', path_id: path.id })) });
    items.push({ id: 'deselect', label: 'Deselect', onPress: () => this.fromMenu(() => this.dispatch({ type: 'select', target_id: null })) });
    return items;
  }

  /** Shut the selected part's menu until the selection changes. */
  private dismissMenu(): void {
    this.menuDismissed = this.store.state.selected_id;
    if (this.menu.openFor !== null) this.menu.hide();
  }

  /** Run a menu option, then shut the menu so the answer above can be read. */
  private fromMenu(run: () => void): void {
    this.menuDismissed = this.menu.openFor;
    this.menu.hide();
    run();
    this.ui.dirty = true;
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
    if (this.debug.enabled || LOG_EVENTS) console.info('[explode]', event ? JSON.stringify(event) : 'replay', '→', this.stepKey());
    if (!event) return;
    this.floatNote = null; // read, or not needed: the learner has started
    // The learner has moved on from the selected part: its menu would stand over the evidence or the cut.
    if ((event.type === 'open_evidence' && event.evidence_id) || event.type === 'unplug') this.dismissMenu();
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

  /**
   * A question in the learner's own words (typed on the 2D page). Because the learner asked, the
   * answer may also act for them: its commands run through the same handlers as a hand or a
   * button, and the lesson engine alone decides what they mean for the lesson.
   */
  async ask(text: string): Promise<TutorAnswer | null> {
    const q = text.trim().slice(0, 300);
    if (!q || this.asking) return null;
    // A GitHub address is unambiguous: propose it directly, with or without a live assistant.
    const repo = this.canPropose ? repoQueryIn(q) : null;
    if (repo) {
      this.proposeSystem(repo);
      return null;
    }
    this.asking = true;
    try {
      const system = this.store.systemId;
      const answer = await this.tutor.ask(this.store, 'free_text', this.liveAllowed, { text: q, view: this.viewContext(), history: this.history.slice() });
      // The plan was checked against the system it was asked about; never run it on another.
      if (this.store.systemId !== system) return null;
      for (const c of answer.plan.commands) {
        if (this.store.systemId !== system) break;
        this.runCommand(c);
      }
      if (this.store.systemId === system) for (const action of answer.plan.actions) this.dispatch({ type: 'apply_action', origin: 'tutor', action });
      // Keyed after the commands ran, so an answer that moved the lesson on stays on screen.
      this.tutorAnswer = { ...answer, stepKey: this.stepKey() };
      if (answer.source === 'live') {
        this.history.push({ role: 'learner', text: q }, { role: 'assistant', text: answer.plan.say });
        if (this.history.length > MAX_HISTORY_TURNS) this.history.splice(0, this.history.length - MAX_HISTORY_TURNS);
      }
      this.ui.dirty = true;
      return answer;
    } finally {
      this.asking = false;
    }
  }

  private placeOrb(): void {
    this.orb?.place(this.ui.layout, this.eyeLocal, this.placedOn === 'air' ? null : STAGE_Y);
  }

  /**
   * The assistant's icon was pressed: start listening, or stop and send what was said. Listening
   * also ends by itself when the speaker stops. What was heard is shown, so a wrong transcript is
   * seen for what it is.
   */
  async toggleVoice(): Promise<void> {
    if (!this.orb || this.voiceBusy) return;
    if (this.voice.active) {
      this.voice.stop();
      return;
    }
    this.sfx.click();
    if (!this.liveAllowed) return this.voiceSay('Voice needs the live AI. Turn "Live AI" on, then ask again.');
    this.voiceSay(null);
    this.orb.set('listening');
    const heard = await this.voice.listen();
    if (heard.kind !== 'audio') {
      this.orb.set('idle');
      return this.voiceSay(VOICE_NOTE[heard.kind]);
    }
    this.voiceBusy = true;
    this.orb.set('thinking');
    try {
      const text = await this.tutor.transcribe(heard.wav);
      if (!text) return this.voiceSay('I could not turn that into words. Voice needs a connection; the buttons still work.');
      const answer = await this.ask(text);
      // The tutor's own notice (it fell back to the offline guide) matters more than the echo.
      this.voiceSay(answer?.note ? null : `Heard: "${text}"`);
      if (answer?.source === 'live') this.speak(answer.plan.say);
    } finally {
      this.voiceBusy = false;
      this.orb.set('idle');
    }
  }

  private voiceSay(note: string | null): void {
    this.voiceNote = note;
    this.ui.dirty = true;
  }

  /** Say an answer aloud where the browser can (many cannot, Quest Browser reportedly among them); the caption always shows it. */
  private speak(text: string): void {
    if (this.sfx.level === 'off' || !SPEAK_ANSWERS) return;
    try {
      const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance(text));
    } catch {
      // No speech here: the caption carries the answer.
    }
  }

  /** What the learner can see and press right now, for the assistant (events only; allocates). */
  private viewContext(): ViewContext {
    const s = this.store.state;
    const hidden = this.consequencesHidden();
    const systems = this.projects;
    return {
      explode_factor: s.explode_factor,
      detail: this.onMechanical ? 'all' : this.detail,
      in_session: !!this.world.session,
      active_path_id: s.active_path_id,
      evidence_open_id: s.evidence_open_id,
      highlighted_ids: s.highlighted_ids.slice(0, 12),
      visible_node_ids: [...visibleAtDetail(this.store.ctx, s, this.onMechanical ? 'all' : this.detail, !hidden)].slice(0, 40),
      awaiting_prediction: hidden,
      buttons: this.buttonDefs.slice(0, 48).map((d) => ({ id: d.id, label: d.label().slice(0, 40), enabled: d.enabled() })),
      can_propose: this.canPropose,
      systems: systems.slice(0, 12).map((p) => ({ id: p.id, name: p.name.slice(0, 80), current: p.id === this.store.systemId })),
    };
  }

  /** Do one thing the learner asked the assistant to do, the way a hand or a button would. */
  private runCommand(c: AssistantCommand): void {
    switch (c.type) {
      case 'press': {
        const def = this.buttonDefs.find((d) => d.id === c.button_id);
        if (def?.enabled()) def.onPress(); // enabled is re-checked: the scene may have moved on
        break;
      }
      case 'select':
        this.dispatch({ type: 'select', target_id: c.target_id });
        break;
      case 'deselect':
        this.dispatch({ type: 'select', target_id: null });
        break;
      case 'set_explode':
        this.dispatch({ type: 'set_explode', factor: c.factor });
        break;
      case 'trace':
        this.dispatch({ type: 'trace', path_id: c.path_id });
        break;
      case 'unplug':
        this.dispatch({ type: 'unplug', edge_id: c.edge_id });
        break;
      case 'plug':
        this.dispatch({ type: 'plug', edge_id: c.edge_id, target_id: c.target_id });
        break;
      case 'predict':
        this.dispatch({ type: 'predict', target_id: c.target_id });
        break;
      case 'open_evidence':
        this.dispatch({ type: 'open_evidence', evidence_id: c.evidence_id });
        break;
      case 'close_evidence':
        this.dispatch({ type: 'open_evidence', evidence_id: null });
        break;
      case 'set_detail':
        this.setDetail(c.level);
        break;
      case 'open_system':
        this.openProject(c.system_id);
        break;
      case 'propose_system':
        this.proposeSystem(c.query, c.kind);
        break;
    }
    this.ui.dirty = true;
  }

  private onKey(e: KeyboardEvent): void {
    // Typing a question must not fire the shortcuts.
    if ((e.target as { tagName?: string } | null)?.tagName === 'INPUT') return;
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
    else if (k === 'k') this.cycleDetail();
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
    else if (k === 'o') this.togglePicker();
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
    const targets = { step: this.stepKey(), backdrop: this.backdrop.mode, placedOn: this.placedOn, planes: this.room?.planeCount ?? 0, perf, view: { ...this.hands.pose, mode: this.hands.gestures.mode }, buttons: this.ui.buttonPositions(this.tmp), card: this.card?.buttonPositions(this.tmp) ?? {}, picker: this.picker.rowPositions(this.tmp), ask: this.orb ? this.orb.group.getWorldPosition(this.tmp).toArray() : null, ...this.view?.targetPositions(this.tmp) };
    console.info('[explode:targets]', JSON.stringify(targets));
  }

  /** Testing only: forget saved progress in both systems and start again at the tutorial. */
  private forgetProgress(): void {
    Store.clearSaved();
    this.done.clear();
    DeskMemory.forget();
    if (this.switching) return;
    if (this.store.has(this.opening.id)) this.loadSystem(this.opening.id, false);
    else this.openProject(this.opening.id, false);
    this.recenterByUser(); // a forgotten spot must not keep the stage: place it afresh
  }

  private next(): void {
    const s = this.store.state;
    if (s.lesson && s.lesson.status !== 'active') {
      if (this.onMechanical) this.switchSystem();
      else {
        const following = this.nextLesson();
        const showcase = this.onShowcase ? undefined : this.showcases[0];
        if (following) {
          this.sfx.collapse(this.modelAt());
          this.store.restart(following.id);
        } else if (showcase) this.openProject(showcase.id);
      }
      return;
    }
    this.dispatch({ type: 'next' });
  }

  /** Open or close the model a quarter of the way (the dock's Spread buttons). */
  private stepExplode(dir: 1 | -1): void {
    const f = Math.round(this.store.state.explode_factor * 4) / 4 + dir * 0.25;
    this.dispatch({ type: 'set_explode', factor: Math.min(1, Math.max(0, f)) });
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
        label: () =>
          lessonDone()
            ? this.onMechanical
              ? 'Continue: software ▸'
              : this.nextLesson()
                ? 'Incident drill ▸'
                : !this.onShowcase && this.showcases[0]
                  ? `Real ${shortName(this.showcases[0])} ▸`
                  : 'Lesson done'
            : 'Next ▸',
        enabled: () => (lessonDone() ? this.onMechanical || this.nextLesson() !== null || (!this.onShowcase && this.showcases.length > 0) : step()?.expect.type === 'next'),
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
        id: 'detail',
        label: () => (this.onMechanical ? 'Detail: all' : `Detail: ${DETAIL_NAME[this.detail]}`),
        enabled: () => !this.onMechanical,
        onPress: () => this.cycleDetail(),
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
        // A draft the learner had built is not a tutorial to skip.
        label: () => (this.onMechanical ? (lessonDone() || this.doneBefore(this.here) || this.here.built ? 'Software ▸' : 'Skip tutorial') : `◂ ${shortName(this.opening)}`),
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
      { id: 'projects', label: () => (this.picker.isOpen ? 'Projects ▴' : 'Projects ▾'), enabled: () => true, onPress: () => this.togglePicker() },
      // The proposal card's buttons (CARD_BUTTONS): enabled only while the card offers them.
      {
        id: 'build-system',
        label: () => 'Build',
        enabled: () => !!this.flow && cardButtons(this.flow.view).some((b) => b.id === 'build'),
        onPress: () => this.pressCard('build'),
      },
      {
        id: 'cancel-build',
        label: () => (this.flow ? (cardButtons(this.flow.view).find((b) => b.id === 'cancel')?.label ?? 'Cancel') : 'Cancel'),
        enabled: () => !!this.flow && cardButtons(this.flow.view).some((b) => b.id === 'cancel'),
        onPress: () => this.pressCard('cancel'),
      },
      // The view dock: what the hand gestures do to the model, as buttons (ui.ts DOCK_GROUPS).
      { id: 'spread-in', label: () => 'Spread −', enabled: () => st().explode_factor > 0, onPress: () => this.stepExplode(-1) },
      { id: 'spread-out', label: () => 'Spread +', enabled: () => st().explode_factor < 1, onPress: () => this.stepExplode(1) },
      { id: 'turn-left', label: () => 'Turn ◂', enabled: () => true, onPress: () => this.hands.gestures.turnBy(Math.PI / 8) },
      { id: 'turn-right', label: () => 'Turn ▸', enabled: () => true, onPress: () => this.hands.gestures.turnBy(-Math.PI / 8) },
      { id: 'tilt-up', label: () => 'Tilt ▲', enabled: () => true, onPress: () => this.hands.gestures.tiltBy(-Math.PI / 12) },
      { id: 'tilt-down', label: () => 'Tilt ▼', enabled: () => true, onPress: () => this.hands.gestures.tiltBy(Math.PI / 12) },
      { id: 'raise', label: () => 'Raise', enabled: () => true, onPress: () => this.hands.gestures.panBy(0, 0.03, 0) },
      { id: 'lower', label: () => 'Lower', enabled: () => true, onPress: () => this.hands.gestures.panBy(0, -0.03, 0) },
      // Zoom works on the open model, as the two-hand pull does (view-gestures).
      { id: 'zoom-out', label: () => 'Zoom −', enabled: () => this.hands.pose.zoom > 1.001, onPress: () => this.hands.gestures.zoomBy(0.8) },
      { id: 'zoom-in', label: () => 'Zoom +', enabled: () => st().explode_factor >= 0.999, onPress: () => this.hands.gestures.zoomBy(1.25) },
      { id: 'home-view', label: () => 'Home view', enabled: () => true, onPress: () => this.hands.gestures.reset() },
      // The two folds of the wide layout (ui.ts SETTINGS_FOLDED, DOCK_FOLDED).
      { id: 'view-tools', label: () => (this.ui.viewToolsOpen ? 'Move ▴' : 'Move ▾'), enabled: () => true, onPress: () => this.ui.toggleViewTools() },
      { id: 'options', label: () => (this.ui.optionsOpen ? 'Options ▴' : 'Options ▾'), enabled: () => true, onPress: () => this.ui.toggleOptions() },
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
        ? this.here.built
          ? 'Lesson complete. That was an AI draft, and nobody has checked it. Explore it freely, or press Continue for the software system.'
          : 'Tutorial complete. Same gestures, different world: continue to the software system.'
        : this.nextLesson()
          ? 'Lesson complete. Ready for an incident? Press Incident drill: something will be broken, and only the symptom will tell you where.'
          : !this.onShowcase && this.showcases[0]
            ? `Lesson complete. Next, a real codebase: press Real ${shortName(this.showcases[0])} to explode the open source framework this app runs on.`
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
      tutor: tutor ? { say: tutor.plan.say, status: tutor.plan.claim_status, source: tutor.source, model: tutor.model } : null,
      note: this.noInputHint ? NO_INPUT_HINT : this.roomDimmed ? ROOM_DIM_NOTE : (this.voiceNote ?? tutor?.note ?? this.floatNote),
      consequence: this.consequencesHidden() ? null : consequenceText(s, labelOf, (id) => this.store.ctx.edges.get(id)?.flows[0]),
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
    // Say why it floats, in a mixed-reality session with the room in view; gone with the first action.
    this.floatNote =
      this.placedOn === 'air' && !!this.world.session && this.backdrop.passthroughAvailable && !!this.room ? (this.room.planeCount === 0 ? FLOAT_NO_ROOM : FLOAT_NO_DESK) : null;
    this.ui.dirty = true;
    this.anchor.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z), 0);
    this.measureEye();
    this.hands.gestures.reset(); // Recenter also undoes any move, zoom or turn of the model
    this.needsRecenter = false;
    if (this.world.session) this.recenteredInXR = true;
  }
}

/** A button-sized name: the last word of the display name before its qualifier ("… headset (teaching model)" → "Headset"). */
function shortName(p: Pick<Project, 'name'>): string {
  const word = p.name.replace(/\s*\(.*\)\s*$/, '').split(/\s+/).pop() ?? '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The display name without its qualifier: "Jupiter (teaching model)" → "Jupiter". */
function shortTitle(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '');
}

/** The picker's kind line for a system built on request: where it came from, short enough to share the line with its mark. */
function builtKind(p: Project): string {
  const from = /\(([^)]*)\)\s*$/.exec(p.name)?.[1] ?? '';
  return from ? `BUILT HERE · ${from.length > 26 ? `${from.slice(0, 25)}…` : from}` : 'BUILT HERE';
}

/** The picker's kind line for a project: the nameplate's, from metadata alone. */
function subjectKind(p: Project): string {
  return subjectOf({ graph: { display_name: p.name, system_kind: p.kind } })[0];
}

/**
 * The nameplate's two lines: the kind of thing on the stage, and its name. The display name's
 * qualifier ("(teaching model)", "(meta/immersive-web-sdk)") goes on the kind line.
 */
export function subjectOf(b: { graph: Pick<ContentBundle['graph'], 'display_name' | 'system_kind'> }): [kind: string, name: string] {
  const name = b.graph.display_name;
  const qualifier = /\(([^)]*)\)\s*$/.exec(name)?.[1] ?? '';
  const bare = name.replace(/\s*\(.*\)\s*$/, '');
  if (b.graph.system_kind === 'mechanical') return [(qualifier || 'model').toUpperCase(), bare];
  return [qualifier ? `CODEBASE · ${qualifier}` : 'CODEBASE', bare];
}

/** The menu's kind line: what sort of part this is, in plain words. */
function kindLabel(kind: string, mechanical: boolean, hypothesis = false): string {
  // A part an AI drafted is never called a teaching model: nobody validated it (ADR-0026).
  if (mechanical) return hypothesis ? 'Part · AI draft, not checked' : 'Part · teaching model';
  const words: Record<string, string> = { function: 'Function', method: 'Method', class: 'Class', module: 'File', cluster: 'Folder', route: 'Route', test: 'Test' };
  return `${words[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)} · in the code`;
}

function readDetail(): DetailLevel {
  try {
    const v = localStorage.getItem(DETAIL_KEY);
    return (DETAIL_LEVELS as readonly string[]).includes(v ?? '') ? (v as DetailLevel) : DEFAULT_DETAIL;
  } catch {
    return DEFAULT_DETAIL;
  }
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
  projects?: Project[],
  explode: ExplodeDeps | null = null,
): ExplodeApp {
  app = new ExplodeApp(world, bundles, tutorUrl, debug, room, anchors, projects, explode);
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
