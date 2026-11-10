/**
 * Dev-only: drive IWER's emulated hands from a webcam.
 *
 * `src/index.ts` mounts this only when `import.meta.env.DEV`, so it never reaches the release
 * build. It shows a small "Webcam hands" panel: pick a camera, press Start. `?webcam` starts it
 * on load (`?webcam=swap` also swaps left/right). MediaPipe Hand Landmarker runs in this page on
 * the camera frames; frames are not sent anywhere. The library (pinned) and its model are fetched
 * from public CDNs on the first Start.
 *
 * Each tracked hand works as a screen pointer (see webcam-hands-map.ts): the emulated hand sits on
 * your line of sight where your hand is in the camera frame, and a pinch clicks what is behind it.
 * The pose and an on/off pinch go into IWER's `XRHandInput`; IWER turns the pinch into real WebXR
 * `selectstart` / `select` / `selectend` events, so the app sees the same input path as the
 * emulator walkthrough and, in shape, a headset. What this does NOT
 * reproduce: Quest's tracking quality, latency and depth, or per-finger joints (IWER shows its own
 * hand poses). Treat anything learned here as emulator-only.
 *
 * While running, IWER is put in `programmatic` control mode (as the CLI walkthrough does): in its
 * default `manual` mode the IWER DevUI copies its own hand handles into the device every frame and
 * would overwrite the webcam. The DevUI's mouse/keyboard controls are hidden until Stop. The mode
 * is re-asserted every frame, because IWER's remote layer (the CLI) drops it when idle; and Stop
 * leaves it alone while that layer holds the device, or CLI commands would be overwritten.
 *
 * Keys while running: H swaps left/right, K recalibrates reach (hold your hands at a comfortable
 * distance, press K).
 *
 * Remembered per browser (localStorage): the camera, the swap, each hand's reach calibration, and
 * whether it was running, so a reload (including an HMR reload) picks up where you left off.
 */
import {
  ClickStabilizer,
  PalmCalibration,
  PinchDetector,
  PointerFilter,
  palmPointer,
  palmSize,
  pinchGapM,
  pinchRatio,
  pointerPose,
  reachFromPalm,
  sideOf,
  type HeadPose,
  type Landmark,
  type Side,
} from './webcam-hands-map.ts';

const MEDIAPIPE_VERSION = '0.10.14';
const MEDIAPIPE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
/** After this long without seeing a hand, its pinch is released so a select cannot stick. */
const LOST_MS = 250;
/** Last-used settings for this viewer (localStorage); a convenience, so every access may fail. */
const SETTINGS_KEY = 'explode.dev.webcam';
const OLD_CAMERA_KEY = 'explode.dev.webcamDeviceId';

// Minimal shapes of what we use from IWER (window.IWER_DEVICE, set by @iwsdk/vite-plugin-dev).
interface IwerVec {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}
interface IwerQuat {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): unknown;
}
interface IwerHand {
  position: IwerVec;
  quaternion: IwerQuat;
  updatePinchValue(v: number): void;
}
interface IwerDevice {
  position: IwerVec;
  quaternion: IwerQuat;
  hands: { left?: IwerHand; right?: IwerHand };
  primaryInputMode: 'controller' | 'hand';
  controlMode: 'manual' | 'programmatic';
  /** IWER's remote-control layer (the CLI). It tracks its own capture and only sets the mode when it thinks it must. */
  remote?: { isCaptured?: boolean };
}

// Minimal shapes of what we use from @mediapipe/tasks-vision.
interface Category {
  categoryName: string;
  score: number;
}
interface HandLandmarkerResult {
  landmarks: Landmark[][];
  worldLandmarks?: Landmark[][];
  handedness?: Category[][];
  handednesses?: Category[][];
}
interface HandLandmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<HandLandmarker>;
  };
}

interface HandState {
  filter: PointerFilter;
  detector: PinchDetector;
  click: ClickStabilizer;
  calibration: PalmCalibration;
  lastSeen: number;
  /** The pinch switch (debounced), and what was last sent to IWER. */
  pinched: boolean;
  sent: boolean;
  /** Last fingertip gap in metres (world landmarks), for the readout. */
  gap: number | null;
}

const newHand = (): HandState => ({
  filter: new PointerFilter(),
  detector: new PinchDetector(),
  click: new ClickStabilizer(),
  calibration: new PalmCalibration(),
  lastSeen: 0,
  pinched: false,
  sent: false,
  gap: null,
});

function resetTracking(h: HandState): void {
  h.filter.reset();
  h.detector.reset();
  h.click.reset();
  h.pinched = false;
  h.sent = false;
}

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

interface WebcamSettings {
  /** Camera last used. */
  deviceId?: string;
  /** Left/right swapped (H). */
  swap?: boolean;
  /** Calibrated palm size per hand, for reach (K re-measures). */
  refPalm?: Partial<Record<Side, number>>;
  /** Running when last left; restarts on load. */
  running?: boolean;
}

function loadSettings(): WebcamSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const s = parsed && typeof parsed === 'object' ? (parsed as WebcamSettings) : {};
    s.deviceId ??= localStorage.getItem(OLD_CAMERA_KEY) ?? undefined;
    return s;
  } catch {
    return {};
  }
}

function storeSettings(s: WebcamSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    localStorage.removeItem(OLD_CAMERA_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;
function loadLandmarker(): Promise<HandLandmarker> {
  landmarkerPromise ??= (async () => {
    const vision = (await import(/* @vite-ignore */ MEDIAPIPE_URL)) as VisionModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    return vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  })();
  landmarkerPromise.catch(() => (landmarkerPromise = null)); // let a later Start retry
  return landmarkerPromise;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}

/** Mount the dev panel. Safe to call once per page. */
export function mountWebcamHands(opts: { autostart?: boolean; swap?: boolean } = {}): void {
  let settings = loadSettings();
  const save = (patch: WebcamSettings) => {
    settings = { ...settings, ...patch };
    storeSettings(settings);
  };
  // ---- panel
  const box = el(
    'div',
    'position:fixed;right:12px;bottom:12px;width:260px;z-index:2147483000;border-radius:10px;overflow:hidden;' +
      'background:rgba(10,17,32,.94);border:1px solid rgba(255,255,255,.25);font:12px system-ui,sans-serif;color:#dfe7f1',
  );
  for (const type of ['pointerdown', 'pointerup', 'click', 'wheel', 'keydown'] as const) {
    box.addEventListener(type, (e) => e.stopPropagation()); // keep clicks off the DevUI / app canvas
  }
  const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px');
  const title = el('b', 'flex:1;font-weight:600');
  title.textContent = 'Webcam hands';
  const toggle = el('button', 'font:600 12px system-ui;padding:4px 10px;border-radius:6px;border:0;background:#1c6e70;color:#fff;cursor:pointer');
  toggle.textContent = 'Start';
  bar.append(title, toggle);
  const select = el('select', 'display:block;width:calc(100% - 16px);margin:0 8px 6px;font:12px system-ui;background:#1a2438;color:#dfe7f1;border:1px solid #33425c;border-radius:6px;padding:3px');
  const stage = el('div', 'position:relative;width:100%;aspect-ratio:16/9;transform:scaleX(-1);background:#000;display:none'); // mirrored, like a mirror
  const video = el('video', 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.7');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const canvas = el('canvas', 'position:absolute;inset:0;width:100%;height:100%');
  stage.append(video, canvas);
  const label = el('div', 'padding:6px 8px;line-height:1.35;color:#a9b6c6');
  box.append(bar, select, stage, label);
  document.body.append(box);
  const say = (text: string) => {
    label.textContent = text;
  };

  // ---- camera list
  async function listCameras(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      say('This page has no camera access (needs a secure origin such as https://localhost).');
      toggle.disabled = true;
      return;
    }
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const keep = select.value || settings.deviceId;
    select.replaceChildren(
      ...cams.map((c, i) => {
        const o = document.createElement('option');
        o.value = c.deviceId;
        o.textContent = c.label || `Camera ${i + 1}`; // labels appear once the camera is allowed
        return o;
      }),
    );
    if (cams.length === 0) {
      const o = document.createElement('option');
      o.textContent = 'No camera found';
      select.append(o);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    if (keep && cams.some((c) => c.deviceId === keep)) select.value = keep;
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void listCameras());

  // ---- tracking state
  const hands: Record<Side, HandState> = { left: newHand(), right: newHand() };
  let swap = opts.swap ?? settings.swap ?? false;
  let stream: MediaStream | null = null;
  let raf = 0;
  let running = false;
  let starting = false;
  const head: HeadPose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  const ctx = canvas.getContext('2d');

  const device = (): IwerDevice | undefined => (window as unknown as { IWER_DEVICE?: IwerDevice }).IWER_DEVICE;

  window.addEventListener('keydown', (e) => {
    if (!running) return;
    const k = e.key.toLowerCase();
    if (k === 'h') {
      swap = !swap;
      save({ swap });
    } else if (k === 'k') {
      for (const s of ['left', 'right'] as const) hands[s].calibration.reset();
      save({ refPalm: {} }); // re-measured and saved over the next few frames
    }
  });

  async function start(): Promise<void> {
    if (running || starting) return;
    const dev = device();
    if (!dev) {
      say('IWER is not active on this page, so there are no emulated hands to drive.');
      return;
    }
    starting = true;
    toggle.disabled = true;
    try {
      say('Opening the camera…');
      // The IWSDK-managed (Playwright) browser can leave the permission request pending.
      const slow = setTimeout(
        () =>
          say(
            `Waiting for camera permission. Allow it in this window's address bar, or open ${location.origin}/?webcam in your own Chrome (IWER runs there too).`,
          ),
        4000,
      );
      const deviceId = select.value || undefined;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: 640, height: 360 },
          audio: false,
        });
      } finally {
        clearTimeout(slow);
      }
      const used = stream.getVideoTracks()[0]?.getSettings().deviceId;
      await listCameras(); // labels are available now
      if (used) {
        select.value = used;
        save({ deviceId: used });
      }
      video.srcObject = stream;
      stage.style.display = 'block';
      await video.play().catch(() => undefined);

      say('Loading the hand model (first time only)…');
      const landmarker = await loadLandmarker();

      dev.controlMode = 'programmatic';
      dev.primaryInputMode = 'hand';
      for (const s of ['left', 'right'] as const) {
        resetTracking(hands[s]);
        hands[s].calibration.reset();
        const ref = settings.refPalm?.[s];
        if (ref) hands[s].calibration.seed(ref);
        hands[s].lastSeen = 0;
      }
      running = true;
      save({ running: true });
      toggle.textContent = 'Stop';
      toggle.style.background = '#7a2e2e';
      say('Running. Enter XR, then raise a hand: it is the pointer. Pinch to click.');
      loop(landmarker, dev);
    } catch (err) {
      stopStream();
      say(`Could not start: ${err instanceof Error ? err.message : String(err)}`);
      console.error('[explode:webcam]', err);
    } finally {
      starting = false;
      toggle.disabled = false;
    }
  }

  function stopStream(): void {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    video.srcObject = null;
    stage.style.display = 'none';
  }

  /** `remember: false` keeps the "running" setting, for a restart on camera change. */
  function stop(remember = true): void {
    if (!running) return;
    running = false;
    if (remember) save({ running: false });
    cancelAnimationFrame(raf);
    stopStream();
    const dev = device();
    if (dev) {
      for (const s of ['left', 'right'] as const) if (hands[s].sent) dev.hands[s]?.updatePinchValue(0);
      // Hand control back to the DevUI, unless the CLI's remote layer holds the device: it believes
      // the mode is already programmatic and would not set it again, and it releases by itself.
      if (!dev.remote?.isCaptured) dev.controlMode = 'manual';
    }
    toggle.textContent = 'Start';
    toggle.style.background = '#1c6e70';
    say('Stopped. The emulator controls are back.');
  }

  toggle.addEventListener('click', () => void (running ? stop() : start()));
  select.addEventListener('change', () => {
    save({ deviceId: select.value });
    if (running) {
      stop(false);
      void start();
    }
  });

  function loop(landmarker: HandLandmarker, dev: IwerDevice): void {
    let lastVideoTime = -1;
    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const now = performance.now();
      // The remote layer drops to manual when the CLI has been idle; the DevUI would then overwrite the hands.
      if (dev.controlMode !== 'programmatic') dev.controlMode = 'programmatic';
      const result = landmarker.detectForVideo(video, now);
      const aspect = video.videoWidth / Math.max(1, video.videoHeight);

      head.position[0] = dev.position.x;
      head.position[1] = dev.position.y;
      head.position[2] = dev.position.z;
      head.quaternion[0] = dev.quaternion.x;
      head.quaternion[1] = dev.quaternion.y;
      head.quaternion[2] = dev.quaternion.z;
      head.quaternion[3] = dev.quaternion.w;

      if (ctx && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx?.clearRect(0, 0, canvas.width, canvas.height);

      const labels = result.handedness ?? result.handednesses ?? [];
      const seen = new Set<Side>();
      result.landmarks.forEach((lm, i) => {
        const side = sideOf(labels[i]?.[0]?.categoryName ?? 'Left', swap);
        if (seen.has(side)) return; // two hands given the same label: keep the first
        seen.add(side);
        const state = hands[side];
        const hand = dev.hands[side];
        if (!hand) return;
        const wasSettled = state.calibration.settled;
        const ref = state.calibration.push(palmSize(lm, aspect));
        if (!wasSettled && state.calibration.settled) save({ refPalm: { ...settings.refPalm, [side]: ref } });

        const world = result.worldLandmarks?.[i];
        state.gap = pinchGapM(world);
        const wasPinched = state.pinched;
        state.pinched = state.detector.push(pinchRatio(lm, world, aspect));
        const raw = palmPointer(lm);
        const smooth = state.filter.push(raw.u, raw.v);
        const other = hands[side === 'left' ? 'right' : 'left'];
        const out = state.click.push(now, smooth.u, smooth.v, state.pinched, other.pinched);
        const pose = pointerPose(out.u, out.v, reachFromPalm(palmSize(lm, aspect), ref), head);
        hand.position.set(pose.position[0], pose.position[1], pose.position[2]);
        hand.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
        if (out.pinch !== state.sent) hand.updatePinchValue(out.pinch ? 1 : 0);
        state.sent = out.pinch;
        // Log each press and release so a session can be read back from the console.
        if (state.pinched !== wasPinched) {
          const r = (n: number) => Math.round(n * 1000) / 1000;
          console.log(
            `[explode:webcam] ${side} ${state.pinched ? 'pinch' : 'release'} gap=${state.gap === null ? '?' : r(state.gap)} ` +
              `pointer=${r(out.u)},${r(out.v)} pos=${pose.position.map(r).join(',')} quat=${pose.quaternion.map(r).join(',')}`,
          );
        }
        state.lastSeen = now;

        if (ctx) {
          ctx.strokeStyle = state.pinched ? '#3ccfcf' : side === 'right' ? '#f2c14e' : '#dfe7f1';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (const [a, b] of CONNECTIONS) {
            ctx.moveTo(lm[a]!.x * canvas.width, lm[a]!.y * canvas.height);
            ctx.lineTo(lm[b]!.x * canvas.width, lm[b]!.y * canvas.height);
          }
          ctx.stroke();
        }
      });

      for (const side of ['left', 'right'] as const) {
        const state = hands[side];
        if (seen.has(side) || state.lastSeen === 0) continue;
        if (now - state.lastSeen > LOST_MS) {
          if (state.sent) dev.hands[side]?.updatePinchValue(0);
          resetTracking(state);
          state.lastSeen = 0;
        }
      }

      // Gap in cm and the pinch switch.
      const show = (s: Side) => {
        if (!seen.has(s)) return '—';
        const h = hands[s];
        const gap = h.gap === null ? '' : `${(h.gap * 100).toFixed(1)} cm `;
        return `${gap}${h.pinched ? 'PINCH' : 'open'}`;
      };
      say(`L: ${show('left')}   R: ${show('right')}${swap ? '   (swapped)' : ''}   ·   pinch to click · H swap · K recalibrate`);
    };
    raf = requestAnimationFrame(tick);
  }

  void listCameras().then(() => {
    const auto = opts.autostart || settings.running === true;
    if (device()) say(auto ? 'Starting…' : 'Pick a camera and press Start.');
    else say('IWER is not active on this page (open the dev server on localhost).');
    if (auto) void start();
  });
}
