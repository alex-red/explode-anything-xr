# EXPLODE

**Pull a system apart with your hands. Trace what flows through it. Break one connection, watch the consequence, and fix it yourself.**

EXPLODE is a hands-first, passthrough mixed-reality app for Meta Quest 3/3S, built with Meta's Immersive Web SDK (WebXR). The session has two parts:

1. **About 90 seconds on a stylized EV drivetrain.** This teaches the gestures and the trace → break → repair loop on a simple teaching model.
2. **The main lesson, on a real TypeScript auth service.** You trace the login request through its actual call graph, back to the source. Then you disconnect a dependency in a sandbox and see a test failure that was recorded at build time. Finally you reconnect it yourself.

Every claim on screen carries a status: observed, in source, teaching model, hypothesis, or unknown. Nothing is promoted beyond its evidence.

Product, architecture, plan and decisions are in [`docs/`](docs/README.md). Agent rules are in [`CLAUDE.md`](CLAUDE.md).

## Repository

```
apps/quest/              IWSDK WebXR app (the thing you put on your face)
packages/contracts/      Zod schemas for every JSON shape (graph, evidence, lesson, actions, tutor)
packages/lesson-engine/  pure reducer + propagation + tutor plan validation + scripted tutor
tools/indexer/           ts-morph indexer for the sample repo
tools/content/           build-time pipeline → apps/quest/src/content/*.bundle.json
content/                 the sample auth-service fixture, mutations, drivetrain spec
services/tutor-proxy/    optional Cloudflare Worker for the live AI tutor
docs/                    review, specs, plan, ADRs, QA, submission checklist
```

## Setup

Requires Node ≥ 24.

```sh
npm install --ignore-scripts      # scripts are skipped on purpose (metavr telemetry/onnx downloads)
npm test                          # unit + integration tests
npx tsc -p tsconfig.json --noEmit && npm run typecheck -w @explode/quest
npm run content:generate          # only after changing content/ or the tools
```

## Manual testing

### 1. Desktop, with the IWER emulator (no headset)

```sh
npx playwright install chromium    # once: the IWSDK-managed emulator browser is Playwright Chromium
cd apps/quest && npm run dev       # IWSDK-managed dev server + emulator browser (port 8081)
# or: npm run dev:runtime           # plain Vite, then open the URL in your own browser
```

- Click **Enter mixed reality** in the emulator to test the immersive path with emulated controllers or hands. Ray-select works as a pinch.
- Without XR, you can click parts with the mouse. Keyboard shortcuts:

| Key | Action |
|---|---|
| E | explode / collapse |
| T | trace |
| N | next |
| U | undo |
| R | reset |
| X | explain selection |
| C | recenter |
| D | debug readout (frame rate, draw calls); on the headset add `?debug` to the URL |

- Emulator controls are documented at <https://iwsdk.dev/guides/02-testing-experience.html>.

### 2. Quest 3 / 3S over USB (fast loop)

1. Enable developer mode and connect USB. Then run `adb reverse tcp:8081 tcp:8081` (localhost counts as a secure context).
2. Open `https://localhost:8081` in Quest Browser and accept the dev certificate.
3. Debug from desktop Chrome at `chrome://inspect`. Watch FPS with the OVR Metrics Tool overlay; the target is a sustained 72.
4. Go through the device checklist in [`docs/QA_MATRIX.md`](docs/QA_MATRIX.md):
   - two-hand pull;
   - the label readability check;
   - pause/resume with the Meta button;
   - Wi-Fi off after the page has loaded.

### 3. Live tutor (optional)

The app works fully offline with the scripted guide. To try the live tutor, deploy `services/tutor-proxy` (see its README) and start the app with `VITE_TUTOR_URL=https://<worker>.workers.dev`.

### 4. Release

The entry is a hosted link, not an APK. See [`docs/FINAL_PLAN.md`](docs/FINAL_PLAN.md) §7 and [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).

```sh
npm run release:manifest                 # after building: hash the build into release/manifest.json
npm run release:verify -- <production url>   # compare the deployed files with that manifest
```
