import { SceneUnderstandingSystem, SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
// Bundles ship as separate files and are fetched when first opened, so the page starts on one
// model instead of parsing all five. `?url` makes Vite emit each as a hashed asset.
import drivetrainUrl from './content/drivetrain.bundle.json?url';
import headsetUrl from './content/headset.bundle.json?url';
import jupiterUrl from './content/jupiter.bundle.json?url';
import iwsdkUrl from './content/iwsdk.bundle.json?url';
import repoDemoUrl from './content/repo-demo.bundle.json?url';
import { startApp } from './app/app.ts';
import { ExplodeClient } from './app/explode-client.ts';
import { fetchBundle, PROJECTS, savedProject, type Project } from './app/projects.ts';
import { savedSystems } from './app/saved-systems.ts';
import { Store } from './app/store.ts';
import { SdkAnchorFrame } from './app/desk-memory.ts';
import { InteractionSystem } from './app/interactions.ts';
import { RoomSystem } from './app/room.ts';
import { VoiceCapture } from './app/voice.ts';

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

const DESKTOP_PREVIEW = 'Desktop preview: click parts, or the nameplate to change project. Keys: E explode, T trace, N next, O projects, U undo, R reset, X explain, D debug readout.';

const BUNDLE_URLS: Record<string, string> = {
  'system:mr-headset': headsetUrl,
  'system:ev-drivetrain': drivetrainUrl,
  'system:jupiter': jupiterUrl,
  'system:auth-service': repoDemoUrl,
  'system:iwsdk': iwsdkUrl,
};
const PROJECT_LIST: Project[] = PROJECTS.map((p) => ({ ...p, load: (onProgress) => fetchBundle(BUNDLE_URLS[p.id]!, onProgress) }));
/** The main lesson path: fetched in the background once the first model is up, so Continue never waits. */
const PREFETCH = ['system:mr-headset', 'system:auth-service'];

async function main(): Promise<void> {
  // Bundles are imported statically, so they ship inside the build. The first tutorial is the
  // opening lesson (the headset); the drivetrain and Jupiter stay reachable from the toolbar's "More".
  // The sample service carries the lessons; the real SDK after it is explored from its most relevant parts.
  // Only the system the visitor will see first is fetched before start: the one used last on this
  // device, else the opening tutorial. The rest load when opened (the picker shows the dial).
  const tutorUrl = (import.meta.env.VITE_TUTOR_URL as string | undefined)?.trim() || null;
  // Systems the visitor had built on an earlier visit (ADR-0026) are kept in this browser and
  // listed after the shipped ones. They only exist where a build server is configured.
  const saved = savedSystems();
  const kept = tutorUrl ? await saved.list() : [];
  const mine = kept.map((s) => savedProject(s, (id) => saved.load(id)));
  const projects: Project[] = [...PROJECT_LIST, ...mine];
  const last = Store.lastActiveSystem();
  const wanted = projects.find((p) => p.id === last) ?? projects[0]!;
  const loadFirst = async (first: Project) => {
    const firstName = first.name.replace(/\s*\(.*\)\s*$/, '');
    setEnter(`Loading ${firstName}…`, false);
    return first.load!((p) => {
      if (p.phase === 'fetch' && p.fraction !== null) setEnter(`Loading ${firstName}… ${Math.round(p.fraction * 100)}%`, false);
      else if (p.phase === 'check') setEnter(`Checking ${firstName}…`, false);
    });
  };
  const [world, bundle] = await Promise.all([
    World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions),
    // A saved system that no longer reads back must not stop the app: open on the tutorial instead.
    wanted.built ? loadFirst(wanted).catch(() => loadFirst(projects[0]!)) : loadFirst(wanted),
  ]);
  world.registerSystem(InteractionSystem);
  // Reads the planes the headset detected, so the stage can stand on the real desk.
  world.registerSystem(RoomSystem);
  // `?debug` shows the in-world frame-rate and draw-call readout (device testing only).
  // The persistent anchor lets the stage return to the same spot on the desk next session.
  const anchors = new SdkAnchorFrame(world.getSystem(SceneUnderstandingSystem) ?? null);
  const explode = tutorUrl ? { api: new ExplodeClient(tutorUrl), saved } : null;
  const app = startApp(world, [bundle], tutorUrl, new URLSearchParams(location.search).has('debug'), world.getSystem(RoomSystem) ?? null, anchors, projects, explode);
  for (const id of PREFETCH) app.prefetch(id);

  // The 2D page's project selector: the same change as the nameplate's picker, for the desktop
  // preview and before entering. Hidden in a session, where the in-world picker takes over.
  const projectBar = document.getElementById('project-bar');
  const projectSelect = document.getElementById('project') as HTMLSelectElement | null;
  if (projectBar && projectSelect) {
    const listProjects = () => {
      projectSelect.replaceChildren();
      for (const p of app.projectList) {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name.replace(/\s*\(.*\)\s*$/, '')}${p.kind === 'software' ? ' · codebase' : ''}`;
        projectSelect.append(option);
      }
      projectSelect.value = app.currentProject;
    };
    listProjects();
    app.onProjectsChange = listProjects;
    app.onProjectChange = (id) => (projectSelect.value = id);
    projectSelect.addEventListener('change', () => {
      app.openProject(projectSelect.value);
      projectSelect.value = app.currentProject; // a change already under way keeps its target
      projectSelect.blur(); // so the keyboard shortcuts work again
    });
    projectBar.hidden = false;
    world.visibilityState.subscribe((v) => (projectBar.hidden = v !== 'non-immersive'));
  }
  // Explode Anything (ADR-0026): a box for a GitHub address, on the 2D page, where there is a
  // keyboard. Shown only once the build server has said it can build; the proposal and its Build
  // and Cancel buttons then appear in the scene.
  const explodeForm = document.getElementById('explode') as HTMLFormElement | null;
  const explodeText = document.getElementById('explode-text') as HTMLInputElement | null;
  if (explodeForm && explodeText) {
    void app.explodeReady.then((ok) => {
      if (!ok) return;
      explodeForm.hidden = world.visibilityState.peek() !== 'non-immersive';
      world.visibilityState.subscribe((v) => (explodeForm.hidden = v !== 'non-immersive'));
      explodeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = explodeText.value.trim();
        if (!text) return;
        app.proposeSystem(text);
        if (world.xrEnabled) setStatus('Looking it up. The proposal appears in the scene: enter to read it, then press Build or Cancel.');
        explodeText.value = '';
        explodeText.blur(); // so the keyboard shortcuts work again
        // The proposal stands in the scene, behind the landing card on a desktop.
        if (landing && !landing.hidden && !world.xrEnabled) landing.hidden = true;
      });
      app.onExplodeAsked = () => explodeText.focus();
    });
  }
  // Typed questions for the assistant, on the 2D page. Only with a live tutor: offline it could
  // answer nothing, and a control that does nothing is worse than none.
  const askForm = document.getElementById('ask') as HTMLFormElement | null;
  const askText = document.getElementById('ask-text') as HTMLInputElement | null;
  const askSend = document.getElementById('ask-send') as HTMLButtonElement | null;
  if (askForm && askText && askSend && tutorUrl) {
    askForm.hidden = false;
    askForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = askText.value.trim();
      if (!text) return;
      askSend.disabled = true;
      void app.ask(text).finally(() => {
        askSend.disabled = false;
        askText.value = '';
      });
    });
    world.visibilityState.subscribe((v) => (askForm.hidden = v !== 'non-immersive'));
  }
  // Dev only: a "Webcam hands" panel to drive the emulated hands from a camera
  // (src/dev/webcam-hands.ts); `?webcam` starts it on load. `import.meta.env.DEV` is false in a
  // build, so this branch and its chunk are dropped.
  if (import.meta.env.DEV) {
    const webcam = new URLSearchParams(location.search).get('webcam');
    import('./dev/webcam-hands.ts')
      .then((m) => m.mountWebcamHands({ autostart: webcam !== null, swap: webcam === 'swap' ? true : undefined }))
      .catch((err: unknown) => console.error('[explode:webcam]', err));
  }

  // Asking aloud needs the microphone. Offer to grant it here, on the 2D page: what a permission
  // prompt does inside an immersive session on a headset is unknown.
  const enableVoice = document.getElementById('enable-voice') as HTMLButtonElement | null;
  if (enableVoice && tutorUrl && VoiceCapture.supported) {
    enableVoice.hidden = false;
    enableVoice.addEventListener('click', () => {
      void VoiceCapture.prime().then((ok) => {
        enableVoice.hidden = ok;
        setStatus(ok ? 'Microphone allowed. In the lesson, press Ask and speak.' : 'The microphone was not allowed. Everything still works with the buttons.');
      });
    });
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
