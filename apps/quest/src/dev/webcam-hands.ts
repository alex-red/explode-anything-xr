/**
 * Dev-only: drive IWER's emulated hands from a webcam.
 *
 * Loaded only from `src/index.ts` when `import.meta.env.DEV` and the page URL has `?webcam`, so it
 * never reaches the release build. MediaPipe Hand Landmarker runs in this page on the camera
 * frames; frames are not sent anywhere. The library (pinned) and its model are fetched from public
 * CDNs the first time.
 *
 * Each tracked hand writes a target-ray pose and a pinch value into IWER's `XRHandInput`. IWER
 * turns the pinch into real WebXR `selectstart` / `select` / `selectend` events, so the app sees
 * the same input path as the emulator walkthrough and, in shape, a headset. What this does NOT
 * reproduce: Quest's tracking quality, latency and depth, or per-finger joints (IWER shows its own
 * hand poses). Treat anything learned here as emulator-only.
 *
 * Keys: H swaps left/right, K recalibrates reach (hold hands at a comfortable distance, press K).
 */
import {
  HandSmoother,
  PalmCalibration,
  handTarget,
  palmSize,
  sideOf,
  yawOf,
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
  smoother: HandSmoother;
  calibration: PalmCalibration;
  lastSeen: number;
  pinch: number;
}

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function overlay(): { video: HTMLVideoElement; canvas: HTMLCanvasElement; label: HTMLDivElement } {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:12px;bottom:12px;width:240px;z-index:2147483000;border-radius:10px;overflow:hidden;' +
    'background:#000;border:1px solid rgba(255,255,255,.25);font:12px system-ui,sans-serif;color:#dfe7f1;pointer-events:none';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;transform:scaleX(-1)'; // shown mirrored, like a mirror
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.7';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const label = document.createElement('div');
  label.style.cssText = 'padding:6px 8px;line-height:1.35';
  label.textContent = 'Webcam hands: starting…';
  stage.append(video, canvas);
  box.append(stage, label);
  document.body.append(box);
  return { video, canvas, label };
}

export async function startWebcamHands(): Promise<void> {
  const { video, canvas, label } = overlay();
  const say = (text: string) => {
    label.textContent = text;
  };

  const device = (window as unknown as { IWER_DEVICE?: IwerDevice }).IWER_DEVICE;
  if (!device) {
    say('Webcam hands: IWER is not active on this page (open the dev server on localhost).');
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, facingMode: 'user' }, audio: false });
  } catch (err) {
    say(`Webcam hands: no camera (${err instanceof Error ? err.message : String(err)}).`);
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);

  say('Webcam hands: loading the hand model…');
  const vision = (await import(/* @vite-ignore */ MEDIAPIPE_URL)) as VisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  device.primaryInputMode = 'hand';
  const hands: Record<Side, HandState> = {
    left: { smoother: new HandSmoother(), calibration: new PalmCalibration(), lastSeen: 0, pinch: 0 },
    right: { smoother: new HandSmoother(), calibration: new PalmCalibration(), lastSeen: 0, pinch: 0 },
  };
  let swap = new URLSearchParams(location.search).get('webcam') === 'swap';

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'h') swap = !swap;
    else if (k === 'k') for (const s of ['left', 'right'] as const) hands[s].calibration.reset();
  });

  const ctx = canvas.getContext('2d');
  const head: HeadPose = { position: [0, 0, 0], yaw: 0 };
  let lastVideoTime = -1;

  const tick = () => {
    requestAnimationFrame(tick);
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);
    const aspect = video.videoWidth / Math.max(1, video.videoHeight);

    head.position[0] = device.position.x;
    head.position[1] = device.position.y;
    head.position[2] = device.position.z;
    const q = device.quaternion;
    head.yaw = yawOf([q.x, q.y, q.z, q.w]);

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
      const hand = device.hands[side];
      if (!hand) return;
      const ref = state.calibration.push(palmSize(lm, aspect));
      const t = state.smoother.push(handTarget(lm, result.worldLandmarks?.[i], aspect, side, head, ref));
      hand.position.set(t.position[0], t.position[1], t.position[2]);
      hand.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
      hand.updatePinchValue(t.pinch);
      state.pinch = t.pinch;
      state.lastSeen = now;

      if (ctx) {
        ctx.strokeStyle = t.pinch >= 0.9 ? '#3ccfcf' : side === 'right' ? '#f2c14e' : '#dfe7f1';
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
        if (state.pinch > 0) device.hands[side]?.updatePinchValue(0);
        state.pinch = 0;
        state.smoother.reset();
      }
    }

    const show = (s: Side) => (seen.has(s) ? (hands[s].pinch >= 0.9 ? 'pinch' : 'open') : '—');
    say(`Webcam hands  L: ${show('left')}  R: ${show('right')}${swap ? '  (swapped)' : ''}  ·  H swap, K recalibrate`);
  };
  say('Webcam hands: ready. Enter XR, then raise your hands.');
  requestAnimationFrame(tick);
}
