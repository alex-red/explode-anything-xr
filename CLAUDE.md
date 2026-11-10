# EXPLODE: agent instructions

A hands-first Quest mixed-reality app for the Meta VR Start Developer Competition 2026. The deadline is **Wed Nov 18, 2026, 12:00 PM PST**. The source of truth for scope, decisions and schedule is `docs/`; start at `docs/README.md`, and use `docs/FINAL_PLAN.md` for the current schedule. The entry is a **hosted link**, not an APK (ADR-0002). There is **no headset**: everything is verified in the IWER desktop emulator. `EXPLODE_VR_Project_Handoff_2026.md` is the historical v1.0 handoff and is superseded wherever `docs/` disagrees.

## Hard rules

- **Never start a dev server or run a build (`bun run dev`, `vite`, `iwsdk dev …`, `vite build`, `wrangler dev/deploy`) unless the user explicitly asks.** If a server is already running, you may use it to verify. Tests and typechecks are fine.
- **Truth contract (ADR-0007):**
  - Never fabricate evidence, source lines, test results or ids.
  - `observed` means a run recorded at build time.
  - Edges are never `observed`.
  - `inferred` and `authored_model` are never promoted.
  - `checkBundleIntegrity` must return `[]`.
- The tutor (LLM or scripted) may only use `TUTOR_ACTION_TYPES`. It cannot break or repair edges, and it cannot pass or advance lessons; only the lesson engine does that.
- Don't commit, push or deploy unless asked. The site is GitHub Pages (`bun run release:pages` publishes the local build to the `gh-pages` branch of `alex-red/explode-anything-xr`); never publish after the release candidate: the entry is frozen.

## Layout

| Path | What | Who edits |
|---|---|---|
| `packages/contracts` | Zod 4 schemas: the single source of truth for every JSON shape | careful: everything depends on it |
| `packages/lesson-engine` | Pure reducer, propagation, plan validator, scripted tutor | agents (keep it pure, add tests) |
| `tools/indexer` | ts-morph indexer for the fixture repo | agents |
| `tools/content` | Build-time pipeline: coverage + mutation evidence, layout, lessons, bundles | agents |
| `content/repo-demo/fixture` | The sample auth-service being taught (MIT, written for this demo) | changing it changes evidence: regenerate |
| `content/drivetrain` | Authored procedural EV drivetrain spec | — |
| `apps/quest` | IWSDK 1.0.1 WebXR app (three.js via `@iwsdk/core`) | agents for logic; the human judges look and clarity in the emulator |
| `services/tutor-proxy` | Optional Cloudflare Worker for the live tutor | agents |
| `tools/release` | Freeze check: release manifest and deployed-file comparison | agents |

Generated bundles are `apps/quest/src/content/*.bundle.json`. Never hand-edit them; run the generator.

## Commands (repo root)

```sh
bun run dev                                  # IWSDK dev server + emulator browser, port 8473 (only when the user asks)
bun run test                                 # vitest: all packages, tools, proxy
bunx tsc -p tsconfig.json --noEmit           # node-side typecheck
bun run --cwd apps/quest typecheck           # app typecheck (run before any device test)
bun run content:generate                     # rebuild both bundles (runs the fixture's tests, mutations)
bun run content:check                        # re-validate committed bundles + hashes
bun run emulator:walkthrough                 # both lessons in the IWER emulator (needs the dev server; `-- --start` runs one)
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
- Hand pinch maps to WebXR `select` (ray). `GrabSystem.useHandPinchForGrab` defaults to false, and proximity grab uses squeeze. That is why P0 interaction is ray + select through `RayInteractable`/`Pressed` (`apps/quest/src/app/interactions.ts`), and explode is a custom two-hand select-pull (`two-hand-pull.ts`).
- Never allocate in per-frame `update()` paths. Text is CanvasTexture panels (`text.ts`), capped at about 30 labels.

## Done means

Tests green (this includes `apps/quest/test/scene-harness.test.ts`, which drives the real app code headless through both lessons), both typechecks green, `content:check` green. For anything that changes how the app looks or feels, also say what was checked in the emulator and what stays unknown without a headset. Never state or imply that something was verified on a device.
