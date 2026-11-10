# EXPLODE — Execution Plan (v2)

> **Superseded on 2026-11-09 by [FINAL_PLAN.md](FINAL_PLAN.md)** for the schedule, gates, work packages and everything about APK packaging. Kept for the risk register and history.

**Supersedes:** handoff §15, §21 · **Team:** one developer + Claude Code agents · **Today:** Sat Oct 24, 2026
**Deadline:** Wed Nov 18, 2026, 12:00 PM PST (1:00 PM MST). **Target: submit the evening of Tue Nov 17.**

---

## Critical path

headset → rules/PWA gate → on-device dev loop → performance spike → **walking skeleton (Nov 1)** → hero lesson → playtests → **release candidate (Nov 15)** → video → submit.

Headless TypeScript work (contracts, engine, indexer, evidence runners, proxy) needs no headset. Agents run it in parallel while the human does on-device work.

## Gates and kill-switches

| ID | Date | Gate / decision |
|---|---|---|
| **K0** | Sat Oct 24 | No headset yet → buy whatever is in stock today (a Quest 3S is fine) |
| **G0** | Sat Oct 24 | On device: ray-pinch a cube in passthrough; controller fallback; recenter; served over HTTPS |
| **G1** | Sun Oct 25 | PWA → APK (Bubblewrap) on the **Competition** release channel; second-account install; offline relaunch |
| **G2** | Mon Oct 26 | Perf spike at sustained 72 fps: 60 nodes, 150 edges, 30 labels, flow animation, glow over passthrough |
| **K1** | Mon Oct 26 | Rules answer on PWA eligibility. An explicit "no" → switch to Unity ([ADR-0001](adr/0001-engine.md)) and cut the drivetrain |
| **K2** | Mon Oct 26 | Perf fails → ≤40 nodes, labels only on the focused cluster, MSDF/merged ribbons ([ADR-0013](adr/0013-render-budget.md)) |
| — | Tue Oct 27 | **Engine locked** |
| **K3** | Thu Oct 29 | Two-hand pull unreliable on device → the button becomes primary, the pull a bonus |
| **G3** | Sun Nov 1 | **Walking skeleton** on the store build. Playtest #1 |
| **K4** | Mon Nov 2 | Skeleton not done → cut the drivetrain tutorial and teach gestures on the repo |
| **K5** | Wed Nov 4 | Drivetrain takes >1.5 days → a battery → switch → motor → wheel circuit from primitives |
| **G4** | Sun Nov 8 | **Feature-complete.** Playtest #2 |
| **K6** | Sun Nov 8 | LLM flaky → scripted tutor by default; live behind an "Ask (live)" chip |
| **K7** | Sun Nov 8 | Voice stays P2 unless the Oct 26 spike passed *and* there is slack |
| **Freeze** | Tue Nov 10 | Feature freeze + video rough cut |
| **K8** | Thu Nov 12 | No VR Glasses claim unless tested in the emulator profile |
| **RC** | Sun Nov 15 | Release candidate frozen, hash archived |

## Day-by-day

Owners: **H** = human (needs the headset or accounts), **A** = background agent (headless, test-verified).

### Week 1: gates and walking skeleton

| Date | H | A | Exit |
|---|---|---|---|
| Fri Oct 23 → **carried to Sat Oct 24** | Buy Quest 3. Read the rules, FAQ and judging by hand; ask the PWA question on Devpost and the Start Discord. Meta org, Start membership, Dashboard app | Contracts v0 ✅, lesson engine v0 ✅, docs ✅ | K0 |
| **Sat Oct 24** | Developer mode, adb, `adb reverse`, `chrome://inspect`, OVR Metrics. Scaffolded app in AR; hand ray + select; controller fallback; recenter; HTTPS deploy. Check the grab mapping (squeeze vs trigger) | Indexer v0, fixture repo, evidence runners, proxy v0, app skeleton | **G0** |
| Sun Oct 25 | Manifest, service worker, Bubblewrap, `assetlinks.json`, auto-enter. Upload to the Competition channel; second account installs | Content pipeline produces both bundles | **G1** |
| Mon Oct 26 | Perf spike; glow over passthrough; check passthrough shows in captures; 15-min mic/TTS spike | Layout cone test; integrity tests | **G2, K1, K2** |
| Tue Oct 27 | Engine locked; renderer reads the bundles | Indexer v1 (route adapter, cluster overrides) | Locked |
| Wed Oct 28 | Two-hand pull + Explode button on device; select/isolate | Coverage runner hardening | — |
| Thu Oct 29 | Trace and flow animation on device | Mutation runner; engine edge cases | K3 |
| Fri Oct 30 | Unplug → tray; plug → snap/reject on device | Scripted tutor coverage tests | — |
| Sat Oct 31 | Evidence panel readability; undo/reset by replay | Playwright + IWER scripted end-to-end run | — |
| **Sun Nov 1** | **Walking skeleton** on the store build; upload #2; **playtest #1** (you + 1 person, recorded) | — | **G3** |

### Week 2: hero lesson, tutorial, tutor

| Date | H | A | Exit |
|---|---|---|---|
| Mon Nov 2 | Lesson step UI: predict → break → observe → explain → repair (3 sockets) → reflect | Lesson content tweaks from playtest #1 | K4 |
| Tue Nov 3 | Procedural drivetrain look and spin | Drivetrain spec and lesson | — |
| Wed Nov 4 | 90 s tutorial pacing; skip; collapse-to-sphere morph into the repo | — | K5 |
| Thu Nov 5 | Context chips on device | Proxy deployed (rate limit, cap, kill switch) | — |
| Fri Nov 6 | Live tutor on device; 6 s fallback felt in practice | Trust tests: fake symbol, injected comment, malformed plans | — |
| Sat Nov 7 | Pause/resume, localStorage restore, backdrop toggle, offline and first-launch screens, SFX | — | — |
| **Sun Nov 8** | **Feature-complete**; **playtest #2** (2 novices, 1 of them a developer) | — | **G4, K6, K7** |

### Week 3: polish, release candidate, video

| Date | H | A | Exit |
|---|---|---|---|
| Mon Nov 9 | Fix the top 5 playtest issues; profile the worst-case scene | Regression tests for the fixes | — |
| **Tue Nov 10** | **Freeze**; device capture session; **video rough cut** | — | Freeze |
| Wed Nov 11 | Pre-rendered narration, SFX, captions everywhere | Narration script export | — |
| Thu Nov 12 | Reduced motion, one-handed path, text size, left-handed use, two seated heights | Layout field-of-view check vs the Glasses profile | K8 |
| Fri Nov 13 | Visual polish; readability on a Quest 3S if one can be borrowed | — | — |
| Sat Nov 14 | **Playtest #3:** 3 cold novices, metrics ([QA_MATRIX.md §4](QA_MATRIX.md#4-playtest-protocol)) | — | Novice ≤8 min |
| **Sun Nov 15** | **RC:** immutable versioned deploy, final APK, second-account and offline tests, archive the APK and bundle hash | — | **RC** |
| Mon Nov 16 | Final video, screenshots, Devpost text | — | — |
| Tue Nov 17 | Full [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) dry run; **submit tonight** | — | Submitted |
| Wed Nov 18 | Verify only. Touch nothing. Deadline 12:00 PST | — | — |

## Agent vs human split

| Agents own (pure TS, test-verified) | Human owns |
|---|---|
| `packages/contracts`, `packages/lesson-engine` | Everything on the headset: feel, comfort, readability, performance |
| `tools/indexer`, `tools/content` (evidence runners, layout, bundles) | Meta accounts, Dashboard, release channel, signing keystore |
| `services/tutor-proxy` and its tests | Playtests, video capture and edit, Devpost text |
| Playwright + IWER end-to-end scripts; docs updates | Final scope calls at every gate |

Agents follow [CLAUDE.md](../CLAUDE.md). They never start a dev server or run a build unless told.

## Risk register

| # | Risk | L | I | Mitigation / trigger |
|---|---|---|---|---|
| R1 | Devpost rejects PWA/web entries (**VERIFY**) | M | H | Ask on Day 1; K1 on Oct 26; keep content as JSON and the engine pure so a Unity port is small |
| R2 | No headset in time | L | H | Buy in store (K0); IWER emulator for logic meanwhile |
| R3 | A "Competition" channel name or DDA/privacy steps block upload | M | H | First upload Oct 25 (G1); privacy policy page ready |
| R4 | WebXR perf: draw calls, transparency, JS GC; no SpaceWarp, so drops judder | M | H | Perf spike G2; instancing/merging; no per-frame allocations; ≤30 labels |
| R5 | Post-processing or additive glow breaks passthrough blending | M | M | No post-processing; test glow Day 3 |
| R6 | Hand pinch doesn't drive grabs (`useHandPinchForGrab=false`; squeeze vs trigger) | H (known) | M | P0 uses ray + select and a custom pinch-pull ([ADR-0012](adr/0012-input.md)) |
| R7 | Two-hand pull unreliable or occluded | M | M | Handles ~25 cm apart; button equivalent; K3 |
| R8 | Code excerpts unreadable, worst on a 3S | M | M | ≤12 lines, large monospace, 0.5 m; quad layers P2 |
| R9 | Web Speech API missing in Quest Browser (REPORTED) | H | L | Pre-render narration; voice P2 |
| R10 | PWA first launch offline shows nothing | M | M | Designed "connect once" screen; service worker precache ≤30 MB |
| R11 | Hosting or proxy down during judging (to ~Dec 11) | L | H | Static CDN; proxy optional; scripted tutor default |
| R12 | Accidental post-deadline change | L | H | Immutable versioned path; daily hash check |
| R13 | Quest Browser update during judging | L | M | Can't be pinned; noted; smoke test weekly until Dec 11 |
| R14 | Passthrough missing from captures, or low capture resolution | M | M | Verify Oct 26; MQDH/scrcpy/adb fallbacks |
| R15 | Agents misuse IWSDK (young SDK, thin training data) | H | M | Pinned 1.0.1; scaffold skills and rules in `apps/quest/.claude`; typecheck before testing |
| R16 | Session killed on blur/hidden | M | M | Event log in localStorage; restore on relaunch |
| R17 | Proxy abuse or spend | L | M | Rate limit, daily cap, kill switch |
| R18 | Solo burnout / schedule slip | M | H | Gates with cut lists; submit a day early |

## Budget

| Item | Estimate |
|---|---|
| Meta Quest 3 (512 GB) | ~US$500 **VERIFY** current price |
| Static hosting + Worker (through Dec 11) | $0–20 |
| LLM API (Anthropic) | < $50, enforced by the daily spend cap |
| TTS for pre-rendered narration | $0–10 (**VERIFY** license terms) |
| **Total** | **≈ $550–580** |

## Work packages

| WP | Scope | Owner | Acceptance |
|---|---|---|---|
| **WP-CONTRACTS** | Zod schemas, canonical JSON, integrity checks | A ✅ | Unit tests; `content:check` passes |
| **WP-ENGINE** | reduce/replay/undo, propagation, step machine, plan validator, scripted tutor | A ✅ | AT-06, AT-07, AT-08 unit coverage |
| **WP-INDEX** | ts-morph indexer over the fixture; source_range evidence | A | Every relation resolves to the pinned revision (AT-07) |
| **WP-EVIDENCE** | Coverage → test_run; 2–3 mutation runs → mutation_run | A | Observed badges only with records (AT-07) |
| **WP-CONTENT** | Layout cone, lessons, bundles, hash | A | AT-11 automated part; integrity clean |
| **WP-PROXY** | Worker, Anthropic call, validation, limits | A | AT-08, AT-09 |
| **WP-SHELL** | IWSDK app: AR session, input, renderer, panels, toolbar | H + A | G0, AT-01, AT-10 |
| **WP-LESSON-UX** | Tutorial + hero flow on device, captions, feedback | H | AT-03 |
| **WP-RELEASE** | PWA packaging, channel, offline, freeze, video, Devpost | H | AT-01, AT-02, AT-13, AT-14 |

Acceptance IDs are defined in [QA_MATRIX.md](QA_MATRIX.md).
