# Devpost entry: draft

**Status:** draft, Nov 11. Not posted. Every claim below is true of the build at commit time, or is marked. Before submitting: replace each `[TODO]`, resolve each **VERIFY**, and re-read [PRODUCT_SPEC §7](PRODUCT_SPEC.md#7-honesty-rules). Never add a frame-rate, comfort or readability claim that was not measured on a headset.

---

## Title

EXPLODE

## Tagline (one line)

Pull apart the headset you are wearing, on your own desk. Then do the same to a codebase.

## Elevator pitch (about 200 characters)

A hands-first mixed-reality lesson: a model of your headset stands on your real desk, you pull it apart and cut its camera link, and your room goes dark. Then the same moves trace a real login bug to its source.

---

## Innovation & Creativity

- **The device you are wearing, on the desk in front of you.** The first thing on the desk is a model of a headset like the one on your face. You pull it apart with both hands, trace how the room reaches your eyes, and cut the link from the cameras to the processor. The model goes dark downstream, and the app dims your real room to show what that link carries. Repair it, and the room comes back. A lesson about passthrough that takes your passthrough away would not work on any other platform.
- **Then the same moves on a system you cannot see:** a real TypeScript auth service. You trace a login request through its actual call graph to the source lines, cut a dependency in a sandbox, predict what fails, and see the test failure that was recorded when the content was built. Then you plug it back in yourself.
- **Scene understanding and persistent anchors, used for something.** The app reads the headset's room setup to stand the model on your desk, and it remembers the spot through a persistent anchor so the model is there next time.
- **Productivity:** understanding an unfamiliar codebase is slow and abstract. Here you hold its structure, follow one request through it, and learn what depends on what by breaking it safely.

## Experience Design

- **Seated and hands-first, end to end.** Pinch to press, pull two hands apart to explode, push them together to collapse, drag to move, twist to turn. Every gesture also has a button. Controllers work too.
- **The real room changes the experience.** The model stands on your detected desk, its panels stay above the surface, and the lesson's turning point dims your actual room. With passthrough off, that beat cannot play the same way.
- **Onboarding in about 90 seconds,** on the headset model, before the main lesson. Captions lead every step, a gesture guide is one press away, and the app says so when it cannot see your hands.
- **Predict before you see.** Before a failure is revealed, you point at the first part that loses its input; the consequence, the dimming and its sound wait for your answer.
- **Field-of-view aware.** Panels are laid out against measured angular budgets around where you look: a wide layout for Quest 3S and a narrow layout that fits a glasses-class field of view, switchable in the app.
- **Comes back with you.** Finished lessons, progress and the desk spot are remembered on the device.

## Technical Implementation

- **Meta Immersive Web SDK 1.0.1 (WebXR, three.js),** a hosted link: no install.
- **Scene understanding:** WebXR plane detection, mesh detection and anchors, all requested as optional. A pure, tested picker chooses a desk in front of a seated viewer; every failure (no room setup, permission refused, no suitable table, a VR session) falls back to a floating placement.
- **Persistent anchoring:** the desk spot is stored relative to the SDK's persistent anchor and restored when that anchor returns.
- **Truthful content pipeline:** a build-time indexer reads the sample service with ts-morph; a mutation harness runs its test suite against deliberate breaks and records the results. Every claim on screen carries its status (observed, in source, teaching model, hypothesis, unknown), and nothing is promoted beyond its evidence.
- **Pure lesson engine:** an event-sourced reducer replays state from a log, so a killed session resumes on the same step.
- **Spatial sound:** every lesson beat has a synthesized sound placed at the part it belongs to, with the listener following your head.
- **Testing:** [TODO: final count] automated tests, including a headless harness that drives the real app code through every lesson, and an emulator walkthrough that completes both main lessons by emulated ray with controllers and with hands. Draw calls are held under a tested budget (50 in the opening scene at its busiest, limit 120).
- **Performance on Quest 3S:** **VERIFY.** [TODO: frame rate measured on the device, scene, date; or say plainly that it was not measured.]

## Polish & Presentation

- A hologram look built from shaders and additive glow instead of post-processing, so it stays cheap and blends with passthrough.
- Colour carries meaning and nothing else: gold is the traced path, coral is what stopped, teal is your action.
- A coherent spatial sound set, with a mute and a quiet setting.
- [TODO: link the video. Say whether it was captured on a headset or in the emulator; label emulator footage as such.]

---

## Inspiration

[TODO: your own words. Suggested angle: the first week in an unfamiliar codebase; the gap between a diagram and the thing; why breaking something safely teaches faster than reading about it.]

## How we built it

Solo, in TypeScript, between [TODO: start date] and Nov 18, 2026. The Immersive Web SDK for the app, Zod schemas as the single source of truth for every content shape, a build-time content pipeline (indexer, mutation runs, layout, lessons), and the IWER emulator for nearly all testing. [TODO: whether and how the app was checked on a Quest 3S.]

## Known limitations

- The headset and the drivetrain are simplified teaching models, not the devices' actual internals.
- Room anchoring depends on the headset's room setup; without it, the model floats in front of you.
- The codebase is one sample service written for this demo; you cannot load your own repository yet.
- "Observed" results were recorded when the content was built; nothing runs live in the headset.
- [TODO: the live AI tutor's state at submission: on by default, optional, or scripted only.]
- [TODO: anything the headset testing turns up.]

## What's next

- Load your own repository and let the indexer and mutation runs build its lesson.
- Unguided incident drills: the system starts broken and you find the fault.
- Scan real desk objects with your hands and take them apart in place.
- [TODO: target launch date, as the rules ask.]

## Disclosures (keep all of them)

- The headset and the drivetrain are simplified teaching models, not the actual internals of any device. Not affiliated with or endorsed by Meta.
- Dimming your room is an illustration; nothing about your headset changes.
- `auth-service` is a sample service written for this demo (MIT).
- "Observed" means a test run recorded when the content was built; nothing runs live.
- [TODO: if the live tutor ships: what it sends, to whom, and that it is optional.]
- [TODO: emulator footage, if any, is labelled as such.]
