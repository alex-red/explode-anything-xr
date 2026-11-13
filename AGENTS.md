# EXPLODE: agent instructions

A hands-first Quest mixed-reality app for the Meta VR Start Developer Competition 2026. The deadline is **Wed Nov 18, 2026, 12:00 PM PST**. The source of truth for scope, decisions and schedule is `docs/`; start at `docs/README.md`, and use `docs/FINAL_PLAN.md` for the current schedule. The entry is a **hosted link**, not an APK (ADR-0002). There is **no headset**: everything is verified in the IWER desktop emulator. `EXPLODE_VR_Project_Handoff_2026.md` is the historical v1.0 handoff and is superseded wherever `docs/` disagrees.

## Hard rules

- **Never start a dev server or run a build (`bun run dev`, `vite`, `iwsdk dev …`, `vite build`, `bun run proxy:dev`) unless the user explicitly asks.** If a server is already running, you may use it to verify. Tests and typechecks are fine.
- **Truth contract (ADR-0007):**
  - Never fabricate evidence, source lines, test results or ids.
  - `observed` means a run recorded at build time.
  - Edges are never `observed`.
  - `inferred` and `authored_model` are never promoted.
  - `checkBundleIntegrity` must return `[]`.
  - Anything a model chose (the SDK's parent nodes) is `inferred`, cites no evidence, and is shown as a hypothesis. `importance` and `role` are presentation, never evidence.
- The tutor (LLM or scripted) shows things only through `TUTOR_ACTION_TYPES`. It may act for the learner (press a button, unplug, plug, predict, Next: `AssistantCommand`) **only** on a `free_text` turn, where the learner asked in their own words; `validateTutorPlan` rejects commands on every other turn. Commands go through the same handlers as a hand or a button. Nothing but the lesson engine decides that a step is passed (ADR-0011, note of Nov 12).
- Commit messages follow Conventional Commits: `<type>(<optional scope>): <summary>`, lowercase imperative summary, subject ≤ 72 chars. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `style`, `build`, `ci`, `revert`. Scopes are package or area names (`quest`, `content`, `lesson-engine`, `tutor-proxy`, `release`). `.githooks/commit-msg` rejects anything else; `bun install` enables it via `core.hooksPath`.
- Don't commit, push or deploy unless asked. The site is GitHub Pages (`bun run release:pages` publishes the local build to the `gh-pages` branch of `alex-red/explode-anything-xr`); never publish after the release candidate: the entry is frozen.

## Layout

| Path | What | Who edits |
|---|---|---|
| `packages/contracts` | Zod 4 schemas: the single source of truth for every JSON shape | careful: everything depends on it |
| `packages/lesson-engine` | Pure reducer, propagation, plan validator, scripted tutor | agents (keep it pure, add tests) |
| `tools/indexer` | ts-morph indexer for the fixture repo | agents |
| `tools/content` | Build-time pipeline: coverage + mutation evidence, layout, lessons, bundles | agents |
| `content/repo-demo/fixture` | The sample auth-service being taught (MIT, written for this demo) | changing it changes evidence: regenerate |
| `content/iwsdk` | A real repository drawn from its most relevant parts: `source/` is an unmodified copy of three packages of `meta/immersive-web-sdk` at the commit in `SOURCE.json`; `curation.json` is a model's choice of parent nodes | never edit `source/` or `curation.json` by hand: re-copy at a new commit, or run `content:curate` |
| `content/drivetrain` | Authored procedural EV drivetrain spec | — |
| `apps/quest` | IWSDK 1.0.1 WebXR app (three.js via `@iwsdk/core`) | agents for logic; the human judges look and clarity in the emulator |
| `services/tutor-proxy` | Optional Node server for the live tutor and voice questions (`bun run proxy:dev`) | agents |
| `tools/release` | Freeze check: release manifest and deployed-file comparison | agents |

Generated bundles are `apps/quest/src/content/*.bundle.json`. Never hand-edit them; run the generator.

## Commands (repo root)

```sh
bun run dev                                  # IWSDK dev server + emulator browser, port 8473 (only when the user asks)
bun run test                                 # vitest: all packages, tools, proxy
bunx tsc -p tsconfig.json --noEmit           # node-side typecheck
bun run --cwd apps/quest typecheck           # app typecheck (run before any device test)
bun run content:generate                     # rebuild all five bundles (runs the fixture's tests, mutations); offline
bun run content:curate                       # ask the model for the SDK's parent nodes again (calls Meta's Model API with META_API_KEY; only when the user asks)
bun run content:check                        # re-validate committed bundles + hashes
bun run proxy:dev                            # tutor proxy on port 8787, keys from .env (only when the user asks)
bun run emulator:walkthrough                 # headset tutorial, codebase lesson and incident drill in the IWER emulator (needs the dev server; `-- --start` runs one)
bun run release:pages                        # publish apps/quest/dist to GitHub Pages (asks nothing; only when told to deploy)
bun run release:manifest                     # hash a finished build into release/manifest.json (does not build)
bun run release:verify -- <url>              # compare a deployed site with that manifest
```

The package manager is **bun** (`bun install`, `bun run <script>`, `bunx`); `bunfig.toml` keeps npm-style hoisted `node_modules`. Two traps: use `bun run test`, never `bun test` (that is Bun's own test runner, not vitest), and keep the `node` scripts on Node: `content:generate` re-runs the fixture's tests with `process.execPath`, so running it under the Bun runtime would change the evidence.

Node ≥ 24: workspace packages are consumed as `.ts` source through native type stripping. Use explicit `.ts` import extensions and erasable syntax only (no enums or namespaces).

## IWSDK specifics (it is young; don't trust memory)

- Pinned to **@iwsdk/core 1.0.1**. Don't upgrade to 1.1.0-rc.
- Docs: <https://iwsdk.dev>. Project rules and skills come with the scaffold in `apps/quest/AGENTS.md` and `apps/quest/.claude/skills/` (`iwsdk-dev`, `iwsdk-ray`, `iwsdk-grab`, `iwsdk-ui`, `iwsdk-debug`, `iwsdk-pwa-packaging`, `iwsdk-hosting`, …). Read them before touching those areas.
- Import three.js from `@iwsdk/core`, never from `three`.
- `iwsdk.config.json` is the project authority, not `vite.config.ts`.
- Hand pinch maps to WebXR `select` (ray). `GrabSystem.useHandPinchForGrab` defaults to false, and proximity grab uses squeeze. That is why P0 interaction is ray + select through `RayInteractable`/`Pressed` (`apps/quest/src/app/interactions.ts`), and the model is handled by custom select gestures (`hand-gestures.ts` over the pure `view-gestures.ts`): two hands pull to explode then zoom, twist to turn, and one hand drags to move it (ADR-0021).
- IWSDK 1.0.1's ray pointer sticks in `select` when a pinch ends with the ray on nothing, and then ignores that hand's next pinch. `apps/quest/src/app/pointer-unstick.ts` works around it using private SDK fields; re-check it if the SDK version ever changes.
- Never allocate in per-frame `update()` paths. Text is CanvasTexture panels (`text.ts`), capped at about 30 labels.

## Done means

Tests green (this includes `apps/quest/test/scene-harness.test.ts`, which drives the real app code headless through every lesson), both typechecks green, `content:check` green. For anything that changes how the app looks or feels, also say what was checked in the emulator and what stays unknown without a headset. Never state or imply that something was verified on a device.
