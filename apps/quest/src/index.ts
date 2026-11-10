import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ContentBundle } from '@explode/contracts';
import drivetrain from './content/drivetrain.bundle.json';
import repoDemo from './content/repo-demo.bundle.json';
import { startApp } from './app/app.ts';
import { InteractionSystem } from './app/interactions.ts';

const status = document.getElementById('status');
const landing = document.getElementById('landing');
const enter = document.getElementById('enter-xr') as HTMLButtonElement | null;
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

  const nav = navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } };
  const arSupported = world.xrEnabled && !!nav.xr?.isSessionSupported && (await nav.xr.isSessionSupported('immersive-ar').catch(() => false));

  // Installed PWA only: there is no 2D page to click, so spend the app-icon tap on entering
  // mixed reality. In a browser tab (how judges open the link) this never runs.
  if (arSupported && 'getDigitalGoodsService' in window) world.launchXR();

  if (arSupported) {
    setEnter('Enter mixed reality', true);
    enter?.addEventListener('click', () => {
      setStatus('');
      world.launchXR();
    });
    // The landing card belongs to the 2D page; hide it while a session is running.
    world.visibilityState.subscribe((v) => {
      if (landing) landing.hidden = v !== 'non-immersive';
    });
    if (!navigator.onLine) setStatus('You are offline. Everything except the live AI tutor still works.');
  } else {
    setEnter('Open this page on a Meta Quest', false);
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
