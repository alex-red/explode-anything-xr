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

Requires Node ≥ 24 (the scripts run on Node) and Bun ≥ 1.4 (package manager and script runner).

```sh
bun install                       # bun blocks dependency install scripts (metavr telemetry, onnx downloads); do not `bun pm trust` them
bun run test                      # unit + integration tests
bunx tsc -p tsconfig.json --noEmit && bun run --cwd apps/quest typecheck
bun run content:generate          # only after changing content/ or the tools
```

## Manual testing

### 1. Desktop, with the IWER emulator (no headset)

```sh
bunx playwright install chromium   # once: the IWSDK-managed emulator browser is Playwright Chromium
bun run dev                       # IWSDK-managed dev server + emulator browser (port 8473)
# or: bun run --cwd apps/quest dev:runtime   # plain Vite, then open the URL in your own browser
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
| D | debug readout (frame rate, draw calls), and log every accepted event; or add `?debug` to the URL |
| P | log the world position of every button, part and plug |
| 0 | forget saved progress and restart at the tutorial |
| S | switch between the tutorial and the software system |
| V | start a VR session (tests the fallback used when mixed reality is unavailable) |

- Emulator controls are documented at <https://iwsdk.dev/guides/02-testing-experience.html>.

### 2. Quest 3 / 3S over USB (fast loop)

1. Enable developer mode and connect USB. Then run `adb reverse tcp:8473 tcp:8473` (localhost counts as a secure context).
2. Open `https://localhost:8473` in Quest Browser and accept the dev certificate.
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

Live site: <https://alex-red.github.io/explode-anything-xr/>

```sh
bun run release:pages                    # publish the local build to GitHub Pages
bun run release:manifest                 # after building: hash the build into release/manifest.json
bun run release:verify -- <production url>   # compare the deployed files with that manifest
```
