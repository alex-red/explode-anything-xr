# EXPLODE — Plan of Attack (v5, rubric-first, Quest 3S)

**Written:** Wed Nov 11, 2026 · **Deadline:** Wed Nov 18, 2026, 12:00 PM PST · **Target submit:** evening of Tue Nov 17
**Supersedes:** the scope, phases and work packages in [FINAL_PLAN.md](FINAL_PLAN.md) §4–§6 and its "no headset" assumption (§3). FINAL_PLAN's hosting, freeze and release steps (§7) still stand. The Nov 10 scope freeze in [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §6 is reopened by this plan, deliberately.

**Two changes drive this version:**

1. The official judging criteria and rules were read in full on Nov 11 (§1). The current build misses what they name most often.
2. A **Quest 3S is on the way**. Verification moves from "emulator only" to "emulator first, headset decides".

Items marked **VERIFY** are not confirmed. Nothing here is a claim about the shipped app.

---

## 1. What the judges score

Source: [judging page](https://start-developer-competition-26.devpost.com/details/judging) and [official rules](https://start-developer-competition-26.devpost.com/rules) §4–§6, read Nov 11.

**Process.** Stage one is pass/fail: the entry fits the theme and applies the required features. Stage two scores four criteria at 25% each. The rules say AI tools may assist the judging and that humans make the final decisions.

| Criterion (25% each) | What the text rewards | Today | After this plan |
|---|---|---|---|
| **Innovation & Creativity** | Originality; relevance to the Productivity track; use of spatial depth, hands, passthrough, **scene understanding, persistent anchors**; "repeat usage" | Original concept. One fixed lesson. No scene understanding, no anchors, nothing to return to | The model lives on your real desk, anchored and persistent; the lesson is about the device you are wearing |
| **Experience Design** | Seated, hands-first; clear onboarding; habit-forming purpose; **the real room must change the experience**; **FoV-aware design** | Onboarding is strong. Passthrough is a backdrop: the lesson plays the same with it off | The desk is the workbench, parts stack up from it, and one break dims the real room. A narrow-FoV layout mode |
| **Technical Implementation** | Hand tracking, passthrough, spatial anchoring, FoV-aware; **min 60 fps on Quest**; bug-free; anchoring to detected planes; "holding up in rooms the developer never tested" | `sceneUnderstanding: false`. Frame rate never measured on hardware | Plane and mesh detection with fallbacks at every level; measured on a 3S in several rooms |
| **Polish & Presentation** | UI, art direction, **sound design**; text, images, video; real footage, story first | Hologram look is good. Sound is 60 lines of oscillator tones. No video | Spatial sound set; video shot on the headset over a real desk |

**Requirements that apply to every entry** (rules §4): usable with hands end to end; every interaction inside a 2 ft radius; fast cold start, clean pause and resume, satisfying in ten minutes; still a project when the third-party service is removed.

**Rules questions now closed:**

| Question (FINAL_PLAN §2) | Answer |
|---|---|
| Must the video show a headset? | No. Footage "as viewed on a Meta Quest device or via XR Simulator or another equivalent emulator". K0 is closed. Headset footage is still the stronger choice (§9) |
| Video length | Under three minutes; judges need not watch further |
| Public code repository | Not required. The link, video and description are |
| Criteria and weights | Four, equal (table above) |

**A rule that constrains the new feature.** Rules §4 forbids projects containing brand names, logos or "recognizable branded products". See decision D1 in §4.

## 2. Strategy

**Pitch, revised:** *"Pull apart the headset you are wearing, on your own desk. Then do the same to your codebase."*

The model stands on the real desk, and breaking its camera link takes the real room away. That moves the room from backdrop to subject, answers the passthrough test inside the lesson, and gives the video an opening no other entry is likely to have.

**Prize targeting.** One prize per entry; judges assign it.

| Prize | Amount | Case after this plan |
|---|---|---|
| Best New Productivity | $70k / $35k | Needs measured 60 fps and a clean run on real hardware. Possible only if phase 5 passes |
| Boldest Original Concept | $25k | "Would fall apart on any other platform": a lesson about passthrough that switches your passthrough off is exactly that |
| Best First Five Minutes | $25k | The drivetrain onboarding is already our best work; the headset model replaces it as a more personal first payoff |
| Best Agentic Interaction | $25k | Only if the live tutor ships on by default (W6) |

**What we stop doing:** refactors with no user-visible effect, more hologram polish, bring-your-own-repo, voice, multiplayer.

## 3. What a browser on a Quest can actually see

This decides what the app can know about the room. Three sources, in order of reliability:

| Source | Gives | Status |
|---|---|---|
| **Scene understanding** (WebXR plane and mesh detection, anchors) | The room the user set up in the headset: floor, walls, tables as planes; furniture as labelled boxes with dimensions; persistent anchors | In IWSDK 1.0.1 (`SceneUnderstandingSystem`, `XRPlane`, `XRMesh` with `semanticLabel` and `dimensions`, `XRAnchor` with persistence in localStorage). Currently switched off in `iwsdk.config.json`. The emulator ships room environments (`living_room`, `office_small`, …). **S1, answered from the source on Nov 11, not yet from a run:** the emulated Quest 3 supports plane detection, mesh detection and anchors, and feeds the session planes from its room captures, labelled with Meta's set (table, screen, couch, storage, lamp and others). Both features are requested as optional, so a refusal does not stop the session. Seeing a stage land on the emulated table still needs a dev-server run |
| **The user's hands** | Exact positions on real objects: pinch two corners and we know a footprint to the centimetre | Works today; hands are already tracked. No permission needed |
| **Headset cameras** | Pixels, so a vision model could name an object | **Uncertain.** WebXR `camera-access` was rejected by Quest Browser as of Feb 2026 (Horizon OS v85). Meta's help page describes a headset-camera permission for websites, and developers report reaching it through `getUserMedia`, with conflicting accounts of what it returns. **VERIFY on the 3S** (spike S3) |

**Consequences:**

- The room scan knows furniture, not desk items. A laptop, keyboard or mouse is not in it. Which labels Quest Browser returns is **VERIFY** (spike S2): the public registry copy I found lists only desk, couch, floor, ceiling, wall, door, window and global mesh; Meta's guide mentions table and chair.
- So the plan does not depend on recognising anything. The model is placed on the detected table; desk-object scanning is a stretch (W8) and would use the user's hands, not the camera.
- A Quest 3S has no depth sensor (the Quest 3 has one) and a lower-density display, about 20 pixels per degree against 25. Room setup quality and text legibility must be checked on the 3S itself. That is useful: the 3S is the harder judging device.

## 4. The new feature: the headset you are wearing, on your desk

**Decided Nov 11:** the first thing on the desk is a model of a mixed-reality headset like the one the judge has on, and that is what they pull apart. It replaces the earlier idea of scanning and matching laptops, keyboards and mice, which is kept only as a stretch (W8).

**Why this is the better choice:**

- **Scope.** One authored model instead of three, and no measuring, matching, catalogue or camera work. That removes the largest risk in the previous draft.
- **Story.** "The thing on your face, in your hands." Every judge has the real object with them, and the judges know this device better than any other.
- **A break you can feel.** The headset model explains passthrough, and breaking it takes passthrough away (below).

### How it works

1. **Enter.** The app finds the nearest table surface in front of the seated user and places the projector stage on it. No table found: today's floating placement, unchanged.
2. **The model appears on the real desk**, life size, resting on the surface: "This is a headset like the one you're wearing."
3. **Explode.** Two hands pull it apart. The layers stack upward from the desk: facial interface, lenses, display, main board, battery, front cameras, shell, strap and speakers.
4. **Trace.** Follow light from the room to your eyes: front cameras → processor → display → lenses → eye.
5. **Predict, then break** the link from the cameras to the processor. Everything downstream goes dark on the model, **and the app dims your real room to its grid backdrop**, with the caption: "We dimmed your view to show what this link carries. Your headset is fine." Hand tracking is on the same broken branch in the model, shown dark; the user's real hands keep working, and the caption says so.
6. **Repair.** Plug the link back into the right socket and the real room returns.
7. **Bridge.** "Now a system you cannot see": the model folds into the sphere that becomes the codebase.

The dimming in step 5 uses the existing backdrop (`backdrop.ts`, [ADR-0022](adr/0022-hologram-look.md)). It is the passthrough test answered inside the lesson: this beat cannot play the same with passthrough off.

**Place in the flow.** The headset lesson becomes the opening tutorial in the default path, in place of the EV drivetrain. The drivetrain stays in the repository and is reachable from the toolbar's "More", so nothing that works is deleted. The opening must still finish in about 90 seconds.

### The model

One authored procedural spec in the existing drivetrain format (`content/drivetrain/spec.json` plus a lesson), so the lesson engine, layout and renderer are reused. Assets stay procedural ([ADR-0019](adr/0019-assets.md)): our own boxes, cylinders and lens discs, no teardown photographs and no third-party diagrams.

| Part | Role in the model |
|---|---|
| Front cameras (colour and tracking) | See the room and the hands |
| Processor and main board | Builds each frame; runs tracking |
| Battery | Powers everything |
| Display | Shows the frame |
| Lenses | Focus the display for the eye |
| Speakers | Sound |
| Shell, facial interface, strap | Structure |

Two paths: **light** (cameras → processor → display → lenses) and **power** (battery → board → everything). One break in the lesson; the power path is there for the tutor and for a second break if time allows.

### Specifications and provenance

Figures shown on part cards come from the manufacturer's public page, and each is recorded in [DATA_PROVENANCE.md](DATA_PROVENANCE.md) before it ships.

| Fact | Value | Source | Status |
|---|---|---|---|
| Processor and memory | Snapdragon XR2 Gen 2, 8 GB | Meta product page | Seen in search results Nov 11; re-read the page before shipping |
| Colour cameras | Two RGB | Meta product page | Same |
| Optics and display | Fresnel lenses, one LCD panel, 1832 × 1920 per eye | Meta page; press spec tables | Same |
| Weight | 514 g | Press | **VERIFY** on Meta's page |
| Battery | 4,324 mAh | Press, one garbled listing | **VERIFY** |
| Tracking cameras and infrared illuminators, counts | — | Not confirmed by any result | **VERIFY**, or leave the count off the card |

### Decision D1: what the model is called

**Decided Nov 11: name it in text, do not replicate it.** The rules and FAQ were re-read for this on Nov 11. Neither addresses naming the sponsor's device directly, so this is a reading, not a ruling.

| Rules §4 clause | Reading |
|---|---|
| No "commercial or corporate advertising (including … corporate logos, brand names, and slogans)" | Brand names are listed as a form of advertising. Stating which device a teaching model is based on is description, not advertising. The rules and FAQ themselves expect entries to say "Meta Quest 3/3S", and our landing page already does |
| No "recognizable branded products" | This one stands on its own in the list. A faithful replica with the logo and exact styling would fall under it. A stylised hologram of boxes, discs and lenses does not |
| No implied association between the sponsor and anyone's products | Do not suggest the app is official or endorsed |
| No trademark infringement | Plain-text name only; no logo, wordmark or product imagery |

**What ships:**

- The caption and part cards may say "Meta Quest 3S" in plain text: "A simplified teaching model based on the published specifications of the Meta Quest 3S."
- No logo, no wordmark, no product photographs, no exact industrial design. The model stays an abstract hologram.
- One line in the app's disclosures and the Devpost text: "Not affiliated with or endorsed by Meta. Not the device's actual internals."
- The name is never used in the app's title, tagline or icon.

**Residual risk:** the sponsor decides compliance at its sole discretion. A one-line question in the Devpost discussion or the Start Discord costs nothing and is worth sending, but the work does not wait on the answer. If the answer is no, the fallback is a text change: "a headset like the one you're wearing".

### Truth contract ([ADR-0007](adr/0007-evidence.md))

No new statuses and no promotion:

- Every part and connection is `authored_model`: "A simplified teaching model. Not the actual internals of your headset." This line is on the panel every time, as it is for the drivetrain.
- Published figures on part cards cite their source and are shown as the manufacturer's published figure, not as something the app measured.
- The dimmed room is labelled as an illustration at the moment it happens. The app never says or implies that it changed the headset.

### Stretch: your own desk objects (W8)

The earlier idea, kept as an option after the freeze criteria are met: pinch two opposite corners of a real laptop, keyboard or mouse, match the footprint against a small catalogue of generic classes, confirm, and explode it in place. Camera recognition is not planned: WebXR camera access was rejected by Quest Browser as of February 2026, and the `getUserMedia` route is unconfirmed (§3).

## 5. Work packages

Ranked. The cut line moves up if time runs out; it never moves a P0 below the device work.

| WP | What | Main files | Rubric | Size |
|---|---|---|---|---|
| **W1** | **Desk workbench.** Turn on scene understanding. Place the stage on the nearest table plane in front of the user; scale the exploded layout to the table's free area and keep it within 2 ft; persistent anchor so it returns to the same spot; fallbacks for no room setup, permission denied, no table. Recenter re-picks the surface | `iwsdk.config.json`, `app.ts` (placement, recenter), new `room.ts`, `backdrop.ts` | Innovation, Experience, Technical | L |
| **W2** | **Headset model and lesson.** Spec and lesson in the drivetrain format; light and power paths; generator and `content:check` extended; bundle regenerated; the walkthrough covers it | `content/headset/*`, `tools/content`, `packages/contracts` | Innovation, Polish | M |
| **W3** | **The dimming break.** Breaking cameras → processor dims the room to the grid backdrop with its caption; repair restores it. In an opaque (VR fallback) session the backdrop is already on, so the model alone goes dark | `app.ts`, `backdrop.ts`, lesson engine event → view | Experience (purposeful passthrough), Innovation | S |
| **W4** | **Flow and persistence.** Headset lesson first, drivetrain behind "More"; completed lessons saved; the stage returns to the same place on the desk next session | `app.ts`, `store.ts`, `ui.ts` | Experience ("habit-forming"), Innovation ("persistent anchors") | S |
| **W5** | **Sound design.** A coherent procedural set, positioned at the part: stage boot, explode, flow hum, unplug, failure spreading, wrong socket, repair. Master level and mute | `audio.ts` | Polish | S |
| **W6** | **Live tutor on by default**, with a short timeout to the scripted tutor. Deploy the Worker. Needs your Cloudflare account and API key | `services/tutor-proxy`, `tutor-client.ts` | Agentic prize; Innovation | S |
| **W7** | **Narrow-FoV mode.** Essential UI inside a tighter cone; a debug mask to preview it; panels re-flow | `ui.ts`, `debug-readout.ts` | Experience, Technical ("FoV-aware") | S |
| — | *cut line if the headset arrives late* | | | |
| **W8** | Your own desk objects by two-pinch measuring (§4 stretch) | new `scan.ts`, `content/objects/*` | Innovation | L |
| **W9** | One unguided incident drill on the codebase from an already recorded mutation: the system starts broken, you find and repair it | `content/repo-demo`, `tools/content`, lesson engine | Productivity relevance, repeat usage | M |
| **W10** | Hands occlude holograms using depth (the SDK has a depth module) | `iwsdk.config.json`, materials | Polish, Technical | S–M, device-only |

**Constraints that stay:** no allocation in per-frame paths; draw calls within the existing budget test, extended to the new scenes; text through `text.ts` under the label cap; three.js from `@iwsdk/core`; contracts changed carefully with tests; bundles only through the generator.

**New decision records to write as the work lands:** room anchoring and its fallbacks; the headset model and the dimming illustration. [ADR-0003](adr/0003-session-passthrough.md) and [ADR-0012](adr/0012-input.md) get a note.

## 6. Phases

A phase ends when its gate is met. The only fixed date is the deadline. **H** = you, **A** = agent.

| Phase | H | A | Exit gate |
|---|---|---|---|
| *Scaffold, done Nov 11* | — | Plane and mesh detection switched on; `surface-pick.ts` (pure, tested) and `room.ts` choose the desk; `app.ts` stands the stage on it or falls back; `content/headset` spec, lesson and generated bundle with tests. Not yet: panels re-flowed for a desk, persistent anchor, the dimming break, the headset lesson in the app's flow | Tests, both typechecks and `content:check` green. Nothing run in the emulator or on a headset |
| *Phase 2 code, done Nov 11* | — | The headset lesson opens the app; the drivetrain is under the toolbar's "More" (key M). Cutting the camera link dims the room once the prediction is in, with its caption, and repair fades it back (`backdrop.ts` `illustrate`); never on the 2D page or over the virtual backdrop. On a desk the toolbar and gesture card rise above the surface. The emulator walkthrough now runs the headset lesson as the tutorial. Not yet: persistent anchor, completed-lesson tracking, part-card figures | 183 tests, both typechecks and `content:check` green. Emulator walkthrough (Nov 11) passes in controller and hand mode, headset lesson included, after the software layout was spread so no two ray targets overlap (`layout.ts` `spreadApart`, checked by `targetOverlaps`). Not seen: the stage on the emulated table (the run placed it floating), the dimming's look. G2 still needs a human look in the emulator |
| **0. Spikes** | Confirm D1. When the 3S arrives: developer mode, `adb`, room setup of your desk | **S1:** does the emulator room deliver planes and meshes to the app? | S1 answered. S2–S4 run the hour the headset is usable (§7) |
| **1. Desk workbench** | Look at placement in the emulator room | W1, with tests for surface choice and every fallback | **G1:** in an emulator room the stage sits on the table; with scene understanding refused, the app behaves as it does today; both existing lessons still pass the walkthrough |
| **2. Headset on the desk** | Judge the model for clarity; re-read the spec page for the part cards | W2, W3, then W4 | **G2:** in the emulator the headset lesson runs explode → trace → predict → break (room dims) → repair (room returns) → bridge to the codebase; walkthrough, `content:check` and the draw-call test green |
| **3. Sound and tutor** | Cloudflare and key for W6 | W5, W6, W7 | **G3:** every lesson event has a sound; the tutor answers live and falls back when the proxy is unreachable |
| **4. On the headset** | Run the device protocol (§7) in at least three places | Fix what it finds, with a regression test for each | **G4: feature freeze.** 60 fps measured in the worst scene, or the scene cut until it is; no step that cannot be completed by hand |
| **5. Capture and release candidate** | Record on the headset; cut the video; screenshots; Devpost text | Docs match what shipped; tag, build, manifest, publish once, verify | **G5:** release candidate frozen, video public |
| **6. Submit** | Every link opened logged out; submit the evening before | `release:verify` | Submitted |

Phases 1–3 do not wait for the headset. Phase 4 starts the day it arrives and interrupts whatever is in progress, because a failure found there outranks any feature. Phase 5 needs at least a day and a half.

**If the headset has not arrived when phase 3 ends:** freeze on the emulator, ship W1–W7, keep the fallbacks conservative, and say plainly in the entry that the build was not checked on hardware.

## 7. Testing on the Quest 3S

### Setup (once)

- Developer mode on; `adb devices` shows one authorised serial.
- Two ways in: the hosted Pages URL in Quest Browser (what judges do), and the dev server through `adb reverse` for fast iteration, following `apps/quest/.claude/skills/iwsdk-native-xr-test`. The dev server is started only when you ask.
- `chrome://inspect` on the Mac for the headset's console. The `?debug` readout for frame rate and draw calls; OVR Metrics Tool if the readout is not enough.

### Spikes, first hour

| ID | Question | Why it matters |
|---|---|---|
| **S2** | Does an AR session start with plane detection, mesh detection and anchors? Which labels and boxes come back for a real desk? Does the anchor persist across sessions? | Decides W1's details and whether Monitor ships |
| **S3** | Does dimming the room mid-session look right over real passthrough, and is the change comfortable? | Decides the strength and speed of the dimming in W3 |
| **S4** | Frame rate of the current build in its worst scene | The baseline. If it is below 60 now, performance work comes before features |
| **S5** | Is 32 px code text readable at 0.7 m on the 3S? Do pinches hit 4 cm targets? Does the two-hand pull register? | The unknowns listed in FINAL_PLAN §3 |

### Protocol, every release candidate

| Area | Check | Pass |
|---|---|---|
| Cold start | Link → landing → in session | One press, under 10 s on Wi-Fi |
| Hands only | Both lessons, controllers out of reach | Every step completed; no step needed a second try because of aiming |
| Frame rate | Worst software scene, exploded headset model on the desk, dimmed room | ≥ 60 fps sustained, measured for 60 s each |
| Soak | Ten minutes of continuous use | No growth in frame time; no errors in the console |
| Rooms | (a) your desk with room setup, (b) a different table and height, (c) a room with **no** room setup, (d) permission refused, (e) dim light, (f) a cluttered desk | Usable in all six; (c) and (d) land in the floating fallback with a clear caption |
| Reach | Seated, elbows near the body | Everything inside 2 ft; nothing behind the real monitor or under the desk |
| Pause and resume | Take the headset off for a minute; press the Meta button and return; let it sleep | State intact, stage still on the desk |
| Persistence | Quit the browser, return the next day | Stage in the same place on the desk and progress restored, or a clean re-placement if the anchor is gone |
| Dimming | Break and repair the camera link five times | The room dims and returns every time; no flash, no discomfort; caption readable while dimmed |
| Legibility | Evidence panel, captions, tags | Read aloud without leaning in |
| Passthrough look | Holograms over a bright desk and a dark one | Model and text stay visible on both |

Results go into [QA_MATRIX.md](QA_MATRIX.md) as device rows with the date, headset and OS version. A check that was not run is recorded as not run.

### Someone else's eyes

One person who has never seen the app, on the headset, no coaching, five minutes. Note where they stall. This is the only test of "clear onboarding" that means anything.

## 8. Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | Too much scope for one person in under seven days | H | H | Ranked work packages with a cut line; G4 is a hard freeze; W8–W10 are optional |
| 2 | The headset arrives late or not at all | M | H | Phases 1–3 are emulator-verifiable; the late-arrival rule in §6 |
| 3 | Scene understanding behaves differently on the 3S than in the emulator, or the judge never ran room setup | M | H | Every level falls back to today's placement; room (c) and (d) are in the protocol |
| 4 | Below 60 fps with the new model on screen | M | Fatal for the track prize | S4 baseline first; the draw-call test covers the new scene; the model is about ten parts |
| 5 | The dimming reads as a malfunction, or is uncomfortable | M | M | Slow fade, caption at the same moment, checked on the headset (S3); fall back to darkening the model only |
| 6 | Brand-name and sponsor-association rules | L | H | D1: plain-text name only, no logo or replica, a non-affiliation line, and a text-only fallback |
| 7 | Replacing the drivetrain opening breaks a tested flow | L | M | The drivetrain is kept, not deleted; the walkthrough covers both |
| 8 | The new opening dilutes the codebase lesson, which is the Productivity argument | M | M | The headset is the 90-second onboarding; the codebase stays the main lesson; W9 if time allows |
| 9 | A late change breaks the frozen link | L | H | FINAL_PLAN §7 freeze, unchanged |

## 9. Submission materials

These are a quarter of the score and the part an AI screening pass reads most directly.

**Video (under 3:00, aim for 2:00), recorded on the headset over your real desk:**

| Time | Shot |
|---|---|
| 0:00–0:12 | A real desk. A hologram headset lands on it. "This is what you're wearing." Two hands pull it apart |
| 0:12–0:35 | Trace light from the cameras to the eye. Break the camera link: the model goes dark and the real room dims to a grid. Repair: the room comes back |
| 0:35–1:25 | "Now a system you cannot see." The codebase: explode, trace login to source lines, break, the recorded failing test, repair |
| 1:25–1:45 | The tutor acts on the scene. Truth badges in close-up |
| 1:45–2:00 | Next day: the stage is still on the same spot on the desk. Title and the three disclosures |

Captions burned in and an SRT uploaded. No generated footage. If any shot comes from the emulator, it is labelled as an emulator capture ([PRODUCT_SPEC.md §7](PRODUCT_SPEC.md#7-honesty-rules)).

**Devpost text.** Four short sections under the four criterion names, in the rubric's own words where they are true: scene understanding, persistent anchors, seated, hands-first, FoV-aware, 60 fps (only with the measured number, device and date). Then inspiration, how it was built, known limitations, future plans, target launch date. Disclosures as today, plus "the headset is a simplified teaching model, not the actual internals of any device".

**Landing page and README.** The same first sentence as the video. A judge or a model reading only the first screen should learn: what it is, that it uses your real desk, that it needs hands only, and how long it takes.

**Screenshots.** Five, from the headset: the model on a real desk, exploded, the dimmed room at the break, codebase trace with evidence, the recorded failure.

## 10. Verified, and not

- **Read directly:** the judging page and the full rules (Nov 11); the IWSDK 1.0.1 type definitions for scene understanding and anchors; the project's config and content formats.
- **From web search, not confirmed on a device:** Quest Browser camera access; the semantic labels Quest returns; Quest 3S display, sensor and hardware figures.
- **Not run for this plan:** the app, the tests, the emulator. No code was changed.

## Sources

- [Judging criteria](https://start-developer-competition-26.devpost.com/details/judging) · [Official rules](https://start-developer-competition-26.devpost.com/rules)
- [IWSDK scene understanding guide](https://developers.meta.com/horizon/documentation/web/iwsdk-guide-scene-understanding/) · [WebXR plane detection module](https://immersive-web.github.io/real-world-geometry/plane-detection.html) · [semantic labels registry](https://github.com/immersive-web/semantic-labels)
- [Quest Browser mixed reality support](https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/) · [Website permissions on Quest, including headset cameras](https://www.meta.com/en-gb/help/quest/1406582186767703/) · [Forum: `camera-access` request for Quest Browser](https://communityforums.atmeta.com/discussions/Questions_Discussions/request-webxr-raw-camera-access-camera-access-feature-in-quest-browser/1367463)
- [Quest 3S specifications](https://www.uploadvr.com/quest-3s-specs/) · [Quest 3S, 3 and 2 compared](https://roadtovr.com/quest-3s-quest-3-quest-2-specs-compared/)
- [Meta Quest 3S product page](https://www.meta.com/quest/quest-3s/) · [Quest 3S announcement coverage](https://www.uploadvr.com/meta-quest-3s-officially-announced/)
