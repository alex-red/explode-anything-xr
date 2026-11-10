# EXPLODE — Final Implementation Plan (v4, emulator-only)

**Written:** Mon Nov 9, 2026 (night) · **Deadline:** Wed Nov 18, 2026, 12:00 PM PST · **Target submit:** evening of Tue Nov 17
**Supersedes:** v3 of this file, the schedule, gates and work packages in [PLAN.md](PLAN.md), and every "Device" row in [QA_MATRIX.md](QA_MATRIX.md). Everything else in `docs/` still stands.

**Decision (Nov 9):** build and submit as a WebXR link **without buying a headset**. All development and verification happen in the IWER desktop emulator. A real headset appears in this plan only as a borrowed check by someone else.

---

## 1. Where the project is

| Area | State | Evidence |
|---|---|---|
| Contracts, lesson engine, indexer, content pipeline, tutor proxy | Written and tested | 103 tests pass; both typechecks clean; `content:check` ok |
| Quest app | Runs in the emulator. Both lessons completed with emulated controller rays; buttons pressed with emulated hand rays; two-hand pull works both ways. No console errors or warnings | Emulator run, Nov 9 |
| Production build | Builds: 15 files, 7.3 MB, relative paths | `vite build` |
| Rules | A WebXR (IWSDK) entry is submitted as a hosted link, not an APK | Rules text |
| Git | Public repository `alex-red/explode-anything-xr`; `main` is pushed | `git log` |
| Hosting | Live on GitHub Pages at <https://alex-red.github.io/explode-anything-xr/>. The built app loads there with no console errors, responds to the desktop keys, and matches the local build byte for byte. Its session path has not been exercised | `release:verify`, desktop browser |
| Proxy deploy | Not started | — |
| Real hardware | Never run on one, and no headset is planned | — |

## 2. What the rules mean for us

- The entry is **a hosted link** (GitHub Pages or any host). No APK, keystore, release channel or Dashboard work ([ADR-0002](adr/0002-distribution.md)).
- No changes after the entry period, and the link must stay up through judging.
- Judges open the link in Quest Browser, land on the 2D page, and press a button to enter.

**Read by hand during phase 1, because the answers can change this plan:**

1. **Does the video have to show the project running on a headset?** If yes, emulator footage does not qualify and K0 (§8) applies.
2. Judging criteria and weights.
3. Video length limit.
4. The exact "New division" wording, and whether a public code repository is required.

## 3. What "no headset" changes

**What the emulator proves:** the app loads, the session starts, input events reach the app, every lesson step can be completed by ray and pinch, layout stays inside the cone, state persists, and nothing throws.

**What it cannot prove, and judges will experience on real hardware:**

| Unknown | Why it matters | How this plan reduces the risk |
|---|---|---|
| Frame rate | WebXR has no reprojection help; missed frames judder | Cut draw calls to a fixed budget now instead of after measuring (B2) |
| Text readability | Code excerpts are the hardest text; a 3S has lower pixel density | Larger type, fewer lines, by default (B3) |
| Real hand-ray aim and pinch jitter | The emulator points exactly where it is told | Bigger targets and hit areas; presses already fire on release (B4) |
| Two-hand pull with tracked hands | Grip-space distance may behave differently for hands | The Explode button becomes the primary instruction; the pull is a bonus (B5) |
| Passthrough look | Colors and translucency over a real room | Dark panels with bright text already; no new translucent layers |
| Session start on a real browser | Permission prompts, reference space, first pose | Enter falls back to a VR session with the virtual backdrop if AR is refused (B6) |
| Comfort and reach | Seated height, arm length | Layout is already inside a 60°×50° cone at 0.7 m; Recenter stays on the toolbar |

**The one cheap fix for all of these is someone else's headset.** Ten minutes from any Quest 3 or 3S owner opening the dev link would turn most of this table from unknown into known. Finding that person (a friend, a colleague, the Start Discord) is task H1 in §5 and the best use of an hour this week.

**Honesty consequences** (truth contract, [PRODUCT_SPEC.md §7](PRODUCT_SPEC.md#7-honesty-rules)):

- Video and screenshots are real captures of the real app running in the emulator, and are **labelled as emulator captures**. Nothing is presented as headset or passthrough footage.
- If no real-headset check has happened by submission, the Devpost "known limitations" section says so in one plain sentence.
- No frame-rate, comfort or readability claim is made anywhere.

## 4. Scope for Nov 18

**P0 — must ship:**

- Hosted link that enters the session with one press and completes both lessons by ray and pinch, with a button for every gesture.
- Truth badges, the evidence panel, scripted tutor chips.
- The defensive changes B2–B6.
- An automated emulator walkthrough of both lessons (B1), run before every deploy.
- Video and screenshots from the emulator, labelled. Devpost entry. Frozen deploy.

**P1 — only after G2:**

- Live tutor through the proxy (K6).
- Toolbar simplification: the step's primary action large, the rest behind "More".
- Backdrop toggle polish.

**Cut:**

- Buying a headset; every on-device gate, OVR Metrics, and in-person headset playtests.
- Offline relaunch and the service worker.
- Pre-rendered narration, the Playwright suite, separate accessibility toggles, voice, VR Glasses claims, the transfer challenge.
- Everything already cut for link-based submission (APK, keystore, release channel).

## 5. Phases

The plan is organised by phase, not by day. A phase ends when its exit gate is met; the only fixed date is the deadline (Wed Nov 18, 12:00 PM PST), with submission the evening before. **H** = you. **A** = agent, verified by tests, typechecks and the emulator walkthrough.

| Phase | H | A | Exit gate |
|---|---|---|---|
| **1. Harden for unseen hardware** | Read the four rules items (§2), the video rule first. **H1:** find one or two Quest 3/3S owners willing to open a link. Walk both lessons in the emulator window and note anything confusing or ugly | All of B2–B6 are done; the agent side of G1 is met | **G1:** the app's own draw calls are within budget in the worst scene, and the walkthrough passes |
| **2. Host and check the built app** | Send the link and tester sheet to your Quest owners | (First deploy is done, and the landing card can be hidden on desktop.) B8 tester sheet | **G2:** the built app loads from the dev URL and both lessons can be completed from it (by emulator extension if one works, otherwise by a Quest owner) |
| **3. Comprehension and polish** | **Comprehension playtest:** 1–2 people use the desktop preview with the mouse, no coaching; it tests the lesson, not the gestures. Decide K6 | Top fixes from your notes, the playtest and any tester report. Proxy deploy if K6 is yes. Regression tests for every fix | **G3: feature freeze.** Nothing new starts after this |
| **4. Capture and release candidate** | Capture in the emulator, labelled "emulator capture"; cut the video; 3–5 labelled screenshots; Devpost text | Docs match what shipped. Tag, build, `release:manifest`, `release:pages` one last time, `release:verify`. Proofread Devpost text against the truth contract | **G4:** release candidate frozen and the video public |
| **5. Submit** | Dry run; every link opened logged out; submit the evening before the deadline. After that, verify only | `release:verify` | Submitted |

Phases 1 and 2 can overlap: hosting does not wait for the hardening work. Phase 3 should not start before G1.

## 6. Agent work packages

### Done

| WP | What |
|---|---|
| A1 | Presses fire on pinch release; a two-hand pull drops pinches already started |
| A2 | No per-frame allocation; panels repaint only when dirty |
| A3 | Landing page as the first screen |
| A4 | Tree-hash label on evidence; no-hands caption hint |
| A5 | Service worker no longer registered |
| A6 | Freeze check: `bun run release:manifest`, `bun run release:verify -- <url>` |
| A7 | Docs aligned with link-based submission |
| A8 | Debug readout (`?debug`, or D on desktop); accepted events logged as `[explode] …` |
| B1 | Emulator walkthrough: `bun run emulator:walkthrough` (add `-- --start` to let it start and stop a headless dev server). Steps are derived from the lesson definitions; it passes in controller and hand mode, 36 ray presses, about 100 s |
| B7 | `AGENTS.md` files and the unused `sw.js` no longer ship; unused SDK grab and UI-kit features turned off. The 6.8 MB script is the SDK itself and did not shrink |
| B2 | Draw-call budget met: software nodes, edges and flow particles are instanced batches, and labels are capped at 18. Measured outside a session (the app's own content): the worst software scene went from 230 draw calls to 79; the tutorial from 73 to 60. A test holds the worst scene at ≤120 |
| B3 | Larger text: evidence code at 32 px (about 0.9° at 0.7 m) and at most 8 lines, small caption lines at 34 px; the evidence panel is wider and further right, and the caption sits above the tallest layout |
| B4 | Ray targets: software nodes and plugs have invisible hit volumes at least 4 cm across, whatever size they are drawn |
| B5 | Explode-first wording: captions and hints name the button first and the two-hand pull second. Changed in the authored lesson and the generator, then regenerated; the recorded test runs were kept, not re-recorded |
| B6 | VR fallback: if mixed reality is not offered, the page offers a VR session; if it is offered but does not start within 8 s, a second button appears. An opaque session gets the virtual backdrop and the View toggle is locked. Checked in the emulator with a real `immersive-vr` session |
| — | Emulator-run fixes: recenter waits for a real head pose; a press on a part inside a socket ring plugs into it |
| — | Handling the model ([ADR-0021](adr/0021-view-manipulation.md)): one hand drags to move it; two hands pull to explode and then zoom, twist to turn, and carry it; Recenter resets. A press now needs a release on its target. Works around an IWSDK pointer bug that ignored the pinch after a drag. Emulator only: the walkthrough passes in both modes, and emulated-hand runs moved, zoomed and turned the model as expected |

### To do

| WP | Scope | Files | Phase |
|---|---|---|---|
| **B8** | Tester sheet for a remote Quest owner: the link with `?debug`, eight things to try, what to report (frame rate shown, anything unreadable, anything that would not select) | `docs/TESTER_SHEET.md` | 2 |
| **B9** | Proxy deploy prep | `services/tutor-proxy` | 3, only if K6 is yes |

## 7. Hosting and freeze

- **Host:** GitHub Pages, from the `gh-pages` branch of the public repository `alex-red/explode-anything-xr`. The link is <https://alex-red.github.io/explode-anything-xr/>.
- **One site, two roles.** A repository has a single Pages site, so the same URL is the dev site until the freeze and the submitted link after it. `bun run release:pages` publishes the current local build to `gh-pages`.
- **Checking the built app without a headset:** the emulator is injected only by the dev server, so a production build on a desktop browser shows the "open this on a Quest" state plus the mouse preview. To exercise the session path of the hosted build, use a WebXR emulator browser extension on the dev URL. Which extension works with this SDK is unverified; if none does, the hosted session path stays untested until a Quest owner opens it.
- **Freeze (phase 4):** tag the commit; build; `release:manifest` and commit the manifest; `release:pages` one last time; `release:verify`; never run `release:pages` again. Verify again before submitting and weekly until winners are announced.

## 8. Kill switches

| ID | Phase | Trigger → action |
|---|---|---|
| **K0** | 1 | The rules require headset footage in the video → stop and decide: borrow or buy a headset for the capture in phase 4, or do not submit. Emulator footage must not be passed off as headset footage |
| **K2** | 1 | Draw calls cannot reach the budget → at most 40 nodes shown at once, edges only on the active path |
| **K4** | 2 | Hosted build fails where the dev build works → fixing it comes before anything in phase 3 |
| **K6** | 3 | Live tutor: deploy only if G2 was met with time to spare; it stays behind the "Live AI" toggle, off by default, since its latency cannot be judged without hardware |
| **K10** | 4 | A tester reports the app unusable on a real headset and the cause is not quickly fixable → submit with the limitation stated, or withdraw. Your call |

## 9. Risks, re-ranked

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | The app fails or judders on a judge's real headset, and we never knew | M–H | Fatal | H1 remote testers; B2–B6; B1 keeps the logic honest |
| 2 | The video rule needs headset footage | Unknown | Fatal | Read the rule first in phase 1; K0 |
| 3 | Judges mark down an entry with emulator footage or an "untested on hardware" line | M | H | A real tester report removes the line; the video is labelled either way |
| 4 | The hosted build's session path is never exercised before judging | M | H | §7 extension check; H1 |
| 5 | Novices do not understand the lesson | M | H | Desktop comprehension playtest in phase 3; Explode-first captions |
| 6 | Production URL changes or goes down during judging | L | H | §7 freeze; the scripted tutor is the default |
| 7 | Schedule slip, solo | M | H | Feature freeze at G3; nothing new after it |

## 10. How things are verified now

- **Every change:** `bun run test`, both typechecks, `content:check`.
- **Every deploy:** the B1 walkthrough in the emulator, then load the hosted URL in a desktop browser.
- **By you, in the emulator window:** does each step read clearly, does the layout look right, is anything overlapping.
- **By a Quest owner, if H1 succeeds:** the tester sheet (B8).
- **Not verified by anyone unless H1 succeeds:** frame rate, readability, real hand input, passthrough appearance, comfort. These are stated as unknown, never as passing.
