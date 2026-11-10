import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ContentBundle } from '@explode/contracts';
import drivetrain from './content/drivetrain.bundle.json';
import repoDemo from './content/repo-demo.bundle.json';
import { startApp } from './app/app.ts';
import { InteractionSystem } from './app/interactions.ts';

const status = document.getElementById('status');
const setStatus = (text: string) => {
  if (status) status.textContent = text;
};

async function main(): Promise<void> {
  // Bundles are imported statically, so they ship in the build and are precached offline.
  const bundles = [ContentBundle.parse(drivetrain), ContentBundle.parse(repoDemo)];
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);
  world.registerSystem(InteractionSystem);
  const tutorUrl = (import.meta.env.VITE_TUTOR_URL as string | undefined)?.trim() || null;
  startApp(world, bundles, tutorUrl);

  // Installed PWA only (iwsdk-pwa-packaging): there is no 2D page to click, so spend the
  // app-icon tap on entering mixed reality. Browser tabs keep the Enter button instead.
  const nav = navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } };
  if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
    nav.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (supported) world.launchXR();
      })
      .catch(() => undefined);
  }

  const enter = document.getElementById('enter-xr') as HTMLButtonElement | null;
  if (enter) {
    if (world.xrEnabled) {
      enter.hidden = false;
      enter.addEventListener('click', () => world.launchXR());
      world.visibilityState.subscribe((v) => (enter.hidden = v !== 'non-immersive'));
    } else {
      setStatus('WebXR not available in this browser. Desktop preview: click parts; keys E explode, T trace, N next, U undo, R reset, X explain.');
    }
  }
  setStatus(navigator.onLine ? '' : 'Offline. Everything except the live AI tutor still works.');
}

main().catch((err: unknown) => {
  console.error(err);
  setStatus(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});

// Offline-first (ADR-0016): runtime cache-first service worker, production only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
