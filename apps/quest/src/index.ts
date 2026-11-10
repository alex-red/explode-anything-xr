import { SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ContentBundle } from '@explode/contracts';
import drivetrain from './content/drivetrain.bundle.json';
import repoDemo from './content/repo-demo.bundle.json';
import { startApp } from './app/app.ts';
import { InteractionSystem } from './app/interactions.ts';

const status = document.getElementById('status');
const landing = document.getElementById('landing');
const enter = document.getElementById('enter-xr') as HTMLButtonElement | null;
const vrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;
const AR_START_GRACE_MS = 8000;
const setStatus = (text: string) => {
  if (status) status.textContent = text;
};
const setEnter = (label: string, enabled: boolean) => {
  if (!enter) return;
  enter.textContent = label;
  enter.disabled = !enabled;
};

const DESKTOP_PREVIEW = 'Desktop preview: click parts. Keys: E explode, T trace, N next, U undo, R reset, X explain, D debug readout.';

async function main(): Promise<void> {
  // Bundles are imported statically, so they ship inside the build.
  const bundles = [ContentBundle.parse(drivetrain), ContentBundle.parse(repoDemo)];
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);
  world.registerSystem(InteractionSystem);
  const tutorUrl = (import.meta.env.VITE_TUTOR_URL as string | undefined)?.trim() || null;
  // `?debug` shows the in-world frame-rate and draw-call readout (device testing only).
  startApp(world, bundles, tutorUrl, new URLSearchParams(location.search).has('debug'));
  // Dev only: a "Webcam hands" panel to drive the emulated hands from a camera
  // (src/dev/webcam-hands.ts); `?webcam` starts it on load. `import.meta.env.DEV` is false in a
  // build, so this branch and its chunk are dropped.
  if (import.meta.env.DEV) {
    const webcam = new URLSearchParams(location.search).get('webcam');
    import('./dev/webcam-hands.ts')
      .then((m) => m.mountWebcamHands({ autostart: webcam !== null, swap: webcam === 'swap' }))
      .catch((err: unknown) => console.error('[explode:webcam]', err));
  }

  const nav = navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } };
  const supports = async (mode: string): Promise<boolean> =>
    world.xrEnabled && !!nav.xr?.isSessionSupported && (await nav.xr.isSessionSupported(mode).catch(() => false));
  const arSupported = await supports('immersive-ar');
  const vrSupported = await supports('immersive-vr');
  const enterVr = () => world.launchXR({ sessionMode: SessionMode.ImmersiveVR });

  // Installed PWA only: there is no 2D page to click, so spend the app-icon tap on entering
  // mixed reality. In a browser tab (how judges open the link) this never runs.
  if (arSupported && 'getDigitalGoodsService' in window) world.launchXR();

  // The landing card belongs to the 2D page; hide it while a session is running.
  let inSession = false;
  world.visibilityState.subscribe((v) => {
    inSession = v !== 'non-immersive';
    if (landing) landing.hidden = inSession;
  });
  vrButton?.addEventListener('click', () => {
    setStatus('');
    enterVr();
  });

  if (arSupported) {
    setEnter('Enter mixed reality', true);
    enter?.addEventListener('click', () => {
      setStatus('');
      world.launchXR();
      // launchXR reports nothing back. If mixed reality was refused or never starts, offer the
      // same lesson over a plain virtual backdrop instead of leaving a button that does nothing.
      if (vrSupported) {
        setTimeout(() => {
          if (inSession) return;
          setStatus('Mixed reality did not start. You can run the same lesson over a plain virtual backdrop.');
          if (vrButton) vrButton.hidden = false;
        }, AR_START_GRACE_MS);
      }
    });
    if (!navigator.onLine) setStatus('You are offline. Everything except the live AI tutor still works.');
  } else if (vrSupported) {
    // No passthrough session on this device or browser: same lesson, virtual backdrop.
    setEnter('Enter virtual reality', true);
    enter?.addEventListener('click', enterVr);
    setStatus('Mixed reality is not available here, so the lesson runs over a plain virtual backdrop.');
  } else {
    setEnter('Open this page on a Meta Quest', false);
    // The card covers the mouse preview; let a desktop visitor put it away.
    const showPreview = document.getElementById('show-preview');
    if (showPreview && landing) {
      showPreview.hidden = false;
      showPreview.addEventListener('click', () => (landing.hidden = true));
    }
    setStatus(`This browser cannot start a mixed-reality session. Open this link in the browser on a Meta Quest 3 or 3S. ${DESKTOP_PREVIEW}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  setEnter('Could not start', false);
  setStatus(`Something went wrong while loading: ${err instanceof Error ? err.message : String(err)}. Reload the page to try again.`);
});

// The service worker is deliberately not registered (docs/FINAL_PLAN.md F2/F3): as written it
// precaches only index.html and serves cache-first, so it neither makes the app work offline
// after one launch nor lets a redeploy through. Register it again once it precaches the build.
