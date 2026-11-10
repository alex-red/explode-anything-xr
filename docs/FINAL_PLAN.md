# EXPLODE — Final Implementation Plan (v4, emulator-only)

**Written:** Mon Nov 9, 2026 (night) · **Deadline:** Wed Nov 18, 2026, 12:00 PM PST · **Target submit:** evening of Tue Nov 17
**Supersedes:** v3 of this file, the schedule, gates and work packages in [PLAN.md](PLAN.md), and every "Device" row in [QA_MATRIX.md](QA_MATRIX.md). Everything else in `docs/` still stands.

**Decision (Nov 9):** build and submit as a WebXR link **without buying a headset**. All development and verification happen in the IWER desktop emulator. A real headset appears in this plan only as a borrowed check by someone else.

---

## 1. Where the project is

| Area | State | Evidence |
|---|---|---|
| Contracts, lesson engine, indexer, content pipeline, tutor proxy | Written and tested | 100 tests pass; both typechecks clean; `content:check` ok |
| Quest app | Runs in the emulator. Both lessons completed with emulated controller rays; buttons pressed with emulated hand rays; two-hand pull works both ways. No console errors or warnings | Emulator run, Nov 9 |
| Production build | Builds: 17 files, 7.3 MB, relative paths. **Not yet loaded in a browser** | `vite build`, Nov 9 |
| Rules | A WebXR (IWSDK) entry is submitted as a hosted link, not an APK | Rules text |
| Git | 22 logical commits on `main`; nothing pushed | `git log` |
| Hosting, proxy deploy | Not started | — |
| Real hardware | Never run on one, and no headset is planned | — |

## 2. What the rules mean for us

- The entry is **a hosted link** (GitHub Pages or any host). No APK, keystore, release channel or Dashboard work ([ADR-0002](adr/0002-distribution.md)).
- No changes after the entry period, and the link must stay up through judging.
- Judges open the link in Quest Browser, land on the 2D page, and press a button to enter.

**Read by hand before Wednesday, because the answers can change this plan:**

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

**P1 — only after Thursday's gate:**

- Live tutor through the proxy (K6).
- Toolbar simplification: the step's primary action large, the rest behind "More".
- Backdrop toggle polish.

**Cut:**

- Buying a headset; every on-device gate, OVR Metrics, and in-person headset playtests.
- Offline relaunch and the service worker.
- Pre-rendered narration, the Playwright suite, separate accessibility toggles, voice, VR Glasses claims, the transfer challenge.
- Everything already cut for link-based submission (APK, keystore, release channel).

## 5. Schedule

**H** = you. **A** = agent, verified by tests, typechecks and the emulator walkthrough.

| Day | H | A | Exit gate |
|---|---|---|---|
| **Tue Nov 10** | **H1:** find one or two Quest 3/3S owners willing to open a link this week. Read the four rules items (§2). Pick the host and log in | (B1 and B7 are done.) First deploy to the **dev** URL; load the built app in a desktop browser | **G1:** the built app loads from the dev URL, and the walkthrough passes in the emulator. **K0** if the video rule needs a headset |
| **Wed Nov 11** | Walk both lessons yourself in the emulator window; note everything confusing or ugly | B2 draw-call budget. B3 readability. B4 hit areas | **G2:** draw calls for the app's own content within budget in the worst scene; walkthrough still passes |
| **Thu Nov 12** | Second pass in the emulator with hand mode. Send the dev link and the tester sheet (B8) to your Quest owners | B5 Explode-first captions. B6 VR fallback. Landing-card overlap. B8 tester sheet | **G3:** both lessons completed by you from the hosted dev URL, in controller and hand mode |
| **Fri Nov 13** | **Comprehension playtest:** 1–2 people use the desktop preview with the mouse, no coaching. It tests the lesson, not the gestures. Decide K6 | Top fixes from your notes, the playtest and any tester report. Proxy deploy if K6 is yes | **Feature freeze** |
| **Sat Nov 14** | Capture session in the emulator; rough cut with the "emulator capture" label | Regression tests for every fix; docs match what shipped | Rough cut exists |
| **Sun Nov 15** | Last tester feedback in. Fix only what blocks completion | Release candidate: tag, build, `release:manifest`, deploy to **production**, `release:verify` | **RC frozen** |
| **Mon Nov 16** | Final video, 3–5 labelled screenshots, Devpost text | Proofread Devpost text against the truth contract | Video public |
| **Tue Nov 17** | Dry run; every link opened logged out; **submit tonight** | `release:verify` | Submitted |
| **Wed Nov 18** | Verify only | — | Deadline 12:00 PST |

## 6. Agent work packages

### Done

| WP | What |
|---|---|
| A1 | Presses fire on pinch release; a two-hand pull drops pinches already started |
| A2 | No per-frame allocation; panels repaint only when dirty |
| A3 | Landing page as the first screen |
| A4 | Tree-hash label on evidence; no-hands caption hint |
| A5 | Service worker no longer registered |
| A6 | Freeze check: `npm run release:manifest`, `npm run release:verify -- <url>` |
| A7 | Docs aligned with link-based submission |
| A8 | Debug readout (`?debug`, or D on desktop); accepted events logged as `[explode] …` |
| B1 | Emulator walkthrough: `npm run emulator:walkthrough` (add `-- --start` to let it start and stop a headless dev server). Steps are derived from the lesson definitions; it passes in controller and hand mode, 36 ray presses, about 100 s |
| B7 | `AGENTS.md` files and the unused `sw.js` no longer ship; unused SDK grab and UI-kit features turned off. The 6.8 MB script is the SDK itself and did not shrink |
| — | Emulator-run fixes: recenter waits for a real head pose; a press on a part inside a socket ring plugs into it |

### To do

| WP | Scope | Files | When |
|---|---|---|---|
| **B2** | Draw-call budget. Measure the app's own content (not the emulator's room). Target ≤120 in the worst scene: one shared material per node state, instanced or merged software nodes and edges, labels only for the focused cluster and the active path | `graph-view.ts`, `shapes.ts` | Nov 11 |
| **B3** | Readability by default: evidence code at a larger size and at most 8 lines; label and button text sizes raised; nothing below about 1° of visual angle at 0.7 m | `ui.ts`, `text.ts`, `graph-view.ts` | Nov 11 |
| **B4** | Forgiving targets: invisible hit volumes larger than the visible plug, socket and small nodes; minimum 4 cm for anything pressable | `graph-view.ts`, `interactions.ts` | Nov 11 |
| **B5** | Explode-first wording: every caption names the button first and the pull second; the content generator is changed, not the bundles by hand | `tools/content`, `content/` | Nov 12 |
| **B6** | Session fallback: if an AR session is unsupported or refused, offer a VR session with the virtual backdrop, and say which one started | `src/index.ts`, `backdrop.ts`, `iwsdk.config.json` | Nov 12 |
| **B8** | Tester sheet for a remote Quest owner: the link with `?debug`, eight things to try, what to report (frame rate shown, anything unreadable, anything that would not select) | `docs/TESTER_SHEET.md` | Nov 12 |
| **B9** | Proxy deploy prep | `services/tutor-proxy` | Nov 13, only if K6 is yes |

## 7. Hosting and freeze

- **Host:** Cloudflare Pages, two projects: `explode-dev` for every iteration and `explode` for production. The tutor Worker lives in the same account. GitHub Pages is the alternative the rules name; it needs a public repo on a free plan.
- **Checking the built app without a headset:** the emulator is injected only by the dev server, so a production build on a desktop browser shows the "open this on a Quest" state plus the mouse preview. To exercise the session path of the hosted build, use a WebXR emulator browser extension on the dev URL. Which extension works with this SDK is unverified; if none does, the hosted session path stays untested until a Quest owner opens it.
- **Freeze (Nov 15):** tag the commit; build; `release:manifest`; deploy to production once; `release:verify`; never deploy to that project again. Verify again before submitting and weekly until winners are announced.

## 8. Kill switches

| ID | When | Trigger → action |
|---|---|---|
| **K0** | Tue Nov 10 | The rules require headset footage in the video → stop and decide: borrow or buy a headset for one capture day (Sat Nov 14), or do not submit. Emulator footage must not be passed off as headset footage |
| **K2** | Wed Nov 11 | Draw calls cannot reach the budget → at most 40 nodes shown at once, edges only on the active path |
| **K4** | Thu Nov 12 | Hosted build fails where the dev build works → Friday becomes a fix day and the comprehension playtest moves to Saturday morning |
| **K6** | Fri Nov 13 | Live tutor: deploy only if G3 passed on time; it stays behind the "Live AI" toggle, off by default, since its latency cannot be judged without hardware |
| **K10** | Sun Nov 15 | A tester reports the app unusable on a real headset and the cause is not fixable in a day → submit with the limitation stated, or withdraw. Your call, made that day |

## 9. Risks, re-ranked

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | The app fails or judders on a judge's real headset, and we never knew | M–H | Fatal | H1 remote testers; B2–B6; B1 keeps the logic honest |
| 2 | The video rule needs headset footage | Unknown | Fatal | Read the rule Tuesday; K0 |
| 3 | Judges mark down an entry with emulator footage or an "untested on hardware" line | M | H | A real tester report removes the line; the video is labelled either way |
| 4 | The hosted build's session path is never exercised before judging | M | H | §7 extension check; H1 |
| 5 | Novices do not understand the lesson | M | H | Desktop comprehension playtest Friday; Explode-first captions |
| 6 | Production URL changes or goes down during judging | L | H | §7 freeze; the scripted tutor is the default |
| 7 | Schedule slip, solo | M | H | Feature freeze Friday; nothing new after it |

## 10. How things are verified now

- **Every change:** `npm test`, both typechecks, `content:check`.
- **Every deploy:** the B1 walkthrough in the emulator, then load the hosted URL in a desktop browser.
- **By you, in the emulator window:** does each step read clearly, does the layout look right, is anything overlapping.
- **By a Quest owner, if H1 succeeds:** the tester sheet (B8).
- **Not verified by anyone unless H1 succeeds:** frame rate, readability, real hand input, passthrough appearance, comfort. These are stated as unknown, never as passing.
