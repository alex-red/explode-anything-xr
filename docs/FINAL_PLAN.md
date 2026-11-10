# EXPLODE — Final Implementation Plan (v3)

**Written:** Mon Nov 9, 2026 (evening) · **Deadline:** Wed Nov 18, 2026, 12:00 PM PST · **Target submit:** evening of Tue Nov 17
**Supersedes:** the schedule, gates and work packages in [PLAN.md](PLAN.md), and the packaging parts of [ADR-0002](adr/0002-distribution.md), [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) §B and [QA_MATRIX.md](QA_MATRIX.md) AT-01/AT-02/AT-13. Everything else in `docs/` still stands.

---

## 1. Where the project actually is

| Area | State on Nov 9 | Evidence |
|---|---|---|
| Contracts, lesson engine, indexer, content pipeline, tutor proxy | Written and tested | `npm test`: 89/89 pass; both typechecks clean; `content:check` ok for both bundles |
| Quest app (`apps/quest`) | Written, passes the headless scene harness, **never built and never run** in an emulator or on a headset | No `dist/`, no `.iwsdk/`; no file modified since Oct 24 22:10 |
| Headset | **Not bought** (K0 was due Oct 24) | Your answer |
| Device gates G0–G4, playtests #1 and #2 | **None happened** | No trace in the repo |
| Rules question (K1) | **Resolved, and better than assumed** — see §2 | Rules text you quoted |
| Meta admin | Start membership only | Your answer |
| Git | No commits at all; the whole project is untracked | `git log` |
| Hosting, proxy deploy | Not started; `wrangler.toml` still has placeholders | — |

The headless half is ahead of schedule. The on-device half is 16 days behind, with 8 working days left. The plan below is built around that.

## 2. What the rules change

The rules say an IWSDK (WebXR) project is submitted as **a hosted link** (GitHub Pages or any host), not as an APK on a "Competition" release channel. No changes are allowed after the entry period, and the link must stay up through judging.

**Cut entirely** (about two days of planned work and the riskiest admin):

- Bubblewrap/TWA, the signing keystore, `assetlinks.json`, the JDK and Android SDK setup.
- The Competition release channel, the Developer Distribution Agreement, the second-account invite install.
- Auto-enter XR for an installed PWA (the code is a harmless no-op in a browser tab; leave it).

**New consequences:**

- Judges land on a **2D web page in Quest Browser** and must press a button to enter. That page is now the first ten seconds of the product, and today it is a bare button and a status line.
- "Frozen build" means: one production URL, deployed once at the release candidate, never deployed to again, with the commit tagged and file hashes archived.
- Offline relaunch is no longer a judging path (a judge needs the network to open the link). It drops from P0 to P1.
- A developer org in the Meta Dashboard is still needed, but only to turn on developer mode for `adb` and `chrome://inspect`.

**Still to read by hand on Devpost (30 minutes, tonight):** judging criteria and weights, the video length limit, the exact "New division" wording, and whether a public code repository is required.

## 3. Findings from the code review

Found by reading the app code. None is confirmed on a device, because nothing has run on one.

| # | Finding | Where | Severity | Fix |
|---|---|---|---|---|
| F1 | A press fires the moment a pinch starts. The first hand of a two-hand pull will therefore select a node, press a toolbar button, or **commit a prediction** if its ray is over one. The spec's "both pinches within ~400 ms, neither ray on a button" rule is not implemented | `interactions.ts:48`, `two-hand-pull.ts:39` | High (AT-10) | Fire presses on pinch release, and cancel the press if the other hand pinched meanwhile |
| F2 | The service worker precaches only `index.html`. The hashed JS is fetched before the worker controls the page, so one online launch does not make the app work offline | `public/sw.js:8` | Medium (P1 now) | Emit a precache list at build time and derive the cache version from the build hash; or stop registering the worker |
| F3 | The cache name is a hand-edited constant and the cache is cache-first, so a redeploy can keep serving the old build on your own headset during the fix loop | `public/sw.js:5` | Medium | Same fix as F2. Until then, do not register the worker |
| F4 | Per-frame allocation, against the project rule: two `new Set` per frame in `updateEdges`, and `JSON.stringify` of every panel's lines at 10 Hz (16 panels) | `graph-view.ts:324`, `text.ts:52`, `ui.ts:87` | Medium (frame hitches; there is no SpaceWarp) | Move the sets into `derive()`; dirty-check the UI model before rendering |
| F5 | The landing page has no explanation, no "hands only" note, no disclosure line, and no message for a browser without WebXR beyond a status string | `index.html` | High, given §2 | Design it as the real first screen |
| F6 | 14 toolbar buttons are shown at all times in two columns. That is a lot for a cold novice in the first minute | `app.ts:202` | Medium (AT-03) | Show the step's primary action large; fold the rest behind "More" |
| F7 | Evidence shows `path:lines @ <hash>` and the docs call it a pinned git revision, but the indexer always writes a content hash of the fixture tree | `indexer.ts:54,270`, `ui.ts:128` | Low, but it is a truth-contract wording issue | Label it "content hash" in the UI and docs, or record the git revision once commits exist |
| F8 | No hint when hand tracking is off or hands are not visible | — | Medium (judge robustness) | A caption hint when no input source has been seen for a few seconds |
| F9 | Recenter waits until the head is more than 1 mm from the origin. In a `local` reference space the head starts at the origin | `app.ts:315` | Low | Check on device; switch to "first frame with a pose" if it stalls |
| F10 | 67 nodes each own a material, so about 150–200 draw calls with edges, labels and panels | `graph-view.ts:262` | Unknown until measured | Measure first (G2). Fallbacks are already listed in [ADR-0013](adr/0013-render-budget.md) |
| F11 | The grip-space distance used by the pull may not be meaningful for tracked hands | `two-hand-pull.ts:36` | Unknown | Device check on day 1; fall back to the wrist or index-tip joint |

## 4. Scope for Nov 18

**P0 — must ship:**

- Hosted link that opens in Quest Browser and enters passthrough AR with one press, hands only.
- Both lessons completable end to end by hand ray and pinch, with a button for every gesture.
- Truth badges and the evidence panel, readable seated.
- Scripted tutor chips.
- Sustained 72 fps in the worst scene on a Quest 3 (or 3S, whichever you buy).
- Pause and resume through the Meta button.
- Video under the length limit, genuine headset footage. Devpost entry. Frozen deploy.

**P1 — only after the walking skeleton passes on Nov 12:**

- Live tutor through the proxy (decision K6, Nov 13).
- Offline relaunch (F2).
- Toolbar simplification (F6), if playtest #1 shows confusion.
- Backdrop toggle: keep if it works on device, otherwise hide the button.

**Cut now:**

- Everything in §2's cut list.
- Pre-rendered narration (synthesized SFX and captions stay).
- Playwright + IWER end-to-end suite.
- Reduced motion, text-size toggle, left-handed toolbar mirror, one-handed path as separate features. Every gesture already has a button, which covers the one-handed path.
- Any VR Glasses claim, voice, the transfer challenge, and the third playtest.

## 5. Schedule

**H** = you (headset, accounts, judgement of feel). **A** = agent (headless, verified by tests and typechecks).

| Day | H | A | Exit gate |
|---|---|---|---|
| **Mon Nov 9** (tonight) | Find a store with a Quest 3 or 3S in stock for tomorrow morning. Read the four open rules items (§2). Create the Meta developer org (needed for developer mode) | First commit of the whole repo. Work package A (§6): F1, F4, F5, F7, F8 | Repo committed; store located |
| **Tue Nov 10** | **Buy the headset in the morning.** Developer mode, `adb`, `chrome://inspect`, OVR Metrics. First run in the desktop emulator, then on device over `adb reverse`. Walk both lessons with buttons only and write down everything that is wrong | Fix runtime bugs as you report them. Set up hosting; first deploy to a **dev** URL | **G0:** in passthrough, ray-pinch selects a node and presses a button. **K0:** no headset by tonight → see §8 |
| **Wed Nov 11** | Two-hand pull, placement and reach, label and code readability, tray and sockets. Measure frame rate in the worst scene | Fixes from your notes; F9–F11 as needed | **G2:** 72 fps sustained, or K2 cuts applied. **K3:** pull unreliable → the button is primary and the caption says so |
| **Thu Nov 12** | Full lesson pass on the hosted dev URL from a cold browser tab: landing page → AR → drivetrain → repo → complete. Pause and resume. Controller fallback | Fixes; freeze-check script (§6, A6) | **G3 walking skeleton:** both lessons completed hands-only from the hosted URL |
| **Fri Nov 13** | **Playtest #1** in the morning (1–2 people, recorded, no coaching). Decide K6. Check that headset recordings include passthrough | Top-5 fixes; proxy deploy if K6 says yes; F2 and F6 if chosen | **Feature freeze** at end of day |
| **Sat Nov 14** | Polish on device: timing, colors over passthrough, comfort at two seated heights, left hand dominant. Video capture session and rough cut | Regression tests for every fix; docs updated to match what shipped | Rough cut exists |
| **Sun Nov 15** | **Playtest #2** (2–3 cold novices, metrics from [QA_MATRIX.md §4](QA_MATRIX.md#4-playtest-protocol)). Fix only what blocks completion | Release candidate: deploy to the **production** URL, tag the commit, archive file hashes | **RC frozen.** Cold open on the production URL passes the device checklist |
| **Mon Nov 16** | Final video, 3–5 screenshots, Devpost text with the three disclosures | Proofread Devpost text against the truth contract | Video uploaded, public |
| **Tue Nov 17** | Submission dry run; open every link logged out; **submit tonight** | Run the freeze check | Submitted |
| **Wed Nov 18** | Verify only. Touch nothing | — | Deadline 12:00 PST |

There are two slack points: Saturday afternoon and Monday evening. Nothing new starts after Friday.

## 6. Agent work packages

Each one ends with `npm test`, both typechecks and `content:check` green, plus a list of what you must check on the headset.

| WP | Scope | Files | When |
|---|---|---|---|
| **A1** | Press on release, cancelled by a second-hand pinch (F1); harness tests for "first hand of a pull never selects, presses or predicts" | `apps/quest/src/app/interactions.ts`, `two-hand-pull.ts`, `test/scene-harness.test.ts` | Tonight |
| **A2** | Remove per-frame allocation (F4) | `graph-view.ts`, `ui.ts`, `text.ts` | Tonight |
| **A3** | Landing page as the first screen (F5): what it is, one large Enter button, "hands only, seated", the sample-service disclosure, clear messages for no-WebXR and for load failure | `apps/quest/index.html`, `src/index.ts` | Tonight |
| **A4** | Revision wording (F7) and the no-hands hint (F8) | `ui.ts`, `app.ts`, `docs/ARCHITECTURE.md` | Tonight |
| **A5** | Stop registering the service worker until F2 is done; then a build-time precache list with a hash-derived cache name | `src/index.ts`, `public/sw.js`, a small Vite plugin | Unregister tonight; precache Nov 13 if P1 is open |
| **A6** | Freeze check: fetch every file of the production URL, compare SHA-256 with the tagged build, print a diff (new AT-13) | `tools/release/` | Nov 12 |
| **A7** | Bring the docs in line with link-based submission: ADR-0002, SUBMISSION_CHECKLIST §B/§C, QA AT-01/02/13, PLAN | `docs/` | Nov 14 |
| **A8** | In-world debug readout behind a key or URL flag: frame time, draw calls, triangles from `renderer.info` | `apps/quest/src/app/` | Nov 10, before G2 |
| **A9** | Proxy deploy prep: KV namespace, allowed origin, spend cap, kill-switch note | `services/tutor-proxy/wrangler.toml`, its README | Nov 13, only if K6 is yes |

### Status, Nov 9 evening

Done and committed: A1, A2, A3, A4, A8 (open the page with `?debug`, or press D on desktop), and the "unregister" half of A5. The baseline is commit `82aad18`. 94 tests, both typechecks and `content:check` pass. None of it has run in an emulator or on a headset yet.

Not done from F1: the pull still engages when a ray is on a button; the press is cancelled instead, which gives the same result for the learner. [ADR-0008](adr/0008-versioning.md) still says the repo uses a git revision; A7 will correct it.

## 7. Hosting and freeze

- **Host:** Cloudflare Pages, two projects. `explode-dev` takes every iteration. `explode` (production) is deployed once at the release candidate. The tutor Worker lives in the same account, and its `ALLOWED_ORIGINS` is the production origin. GitHub Pages is the alternative the rules name; it needs a public repo on a free plan.
- **Freeze procedure (Nov 15):** tag the commit; build; deploy to production; run A6 and save its output with the bundle `content_hash` values; open the URL in a fresh Quest Browser profile; then never deploy to that project again. Run A6 on Nov 17 before submitting and weekly until winners are announced.
- **Why not versioned paths:** `/v/<semver>-<hash>/` was needed so an installed APK could pin a start URL. With a link submission, a dedicated production project that is never redeployed gives the same guarantee with less to get wrong.

## 8. Kill switches

| ID | When | Trigger → action |
|---|---|---|
| **K0** | Tue Nov 10, 6 PM | Still no headset → order same-day or next-day delivery **and** borrow one for Wednesday. With no headset by Thu Nov 12 there is no genuine footage and the entry cannot be submitted; stop and decide then |
| **K2** | Wed Nov 11 | Below 72 fps → labels on the focused cluster only, hide non-path edges, one shared material per node state, ≤40 nodes ([ADR-0013](adr/0013-render-budget.md)) |
| **K3** | Wed Nov 11 | Two-hand pull works in fewer than 9 of 10 tries → Explode button is primary; the pull stays as a bonus and leaves the first caption |
| **K4** | Thu Nov 12 | Walking skeleton fails on the repo lesson → ship the drivetrain as the full experience and the repo as a guided viewer (trace + evidence, no break/repair). Fails on both → Friday's playtest becomes a fix day and playtest #2 is the only one |
| **K6** | Fri Nov 13 | Live tutor: deploy only if G3 passed on time. Default it on only if answers return in under about 2.5 s on device; otherwise it stays behind the "Live AI" toggle |
| **K9** | Sat Nov 14 | Passthrough missing from recordings → record through `scrcpy`/MQDH casting; as a last resort film the virtual backdrop mode and say so in the video |

## 9. Risks, re-ranked

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | No headset in hand tomorrow | M | Fatal | K0. Everything else in this plan assumes Tuesday |
| 2 | The app has never run; IWSDK runtime behavior differs from the stub the harness uses | H | H | Emulator run first on Tuesday, then device; Wednesday is reserved for the fallout |
| 3 | One person has to fit two weeks of on-device tuning into three days | H | H | Feature freeze Friday; cuts in §4; K3 and K4 |
| 4 | Frame rate over passthrough | M | H | A8 readout, G2, K2 |
| 5 | Novices cannot complete without coaching | M | H | Two playtests; F1, F5, F6 |
| 6 | Code text unreadable on a 3S | M | M | Check Wednesday; raise the mono size and cut the excerpt to 8 lines |
| 7 | Production URL changes or goes down during judging | L | H | §7; proxy is optional and the scripted tutor is the default |
| 8 | Nothing is in git | H today | H | First commit tonight; push to a private remote when you say so |

## 10. What you verify on the headset

The device checklist in [QA_MATRIX.md §3](QA_MATRIX.md#3-device-checklist-every-upload) still applies, with these changes:

- "Cold launch → AR auto-enter" becomes "open the link in Quest Browser → landing page → one press → passthrough AR".
- "Airplane mode relaunch" is P1.
- Added: the first pinch of a two-hand pull never selects, presses or predicts (F1).
- Added: with hand tracking off, the hint appears and the controller ray completes the lesson (F8).
- Added: after a redeploy to the dev URL, a reload shows the new build (F3).
