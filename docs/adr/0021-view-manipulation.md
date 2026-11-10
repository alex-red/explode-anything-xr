# ADR-0021: Handling the model with the hands — move, zoom and turn on top of the two-hand pull

**Status:** Accepted, 2026-11-10 · **Amends:** [ADR-0012](0012-input.md)

## Context

- The exploded view could only be opened and closed. Looking closely at one part of it, or getting it out of the way of a panel, meant moving your head.
- Two hands pulling apart already means "explode" ([ADR-0012](0012-input.md)), and the lessons depend on it. The usual meaning of that gesture elsewhere is "zoom".
- The content is always farther away than the hands ([INTERACTION_SPEC §1](../INTERACTION_SPEC.md)).
- There is no headset: all of this was built and checked in the IWER emulator.

## Decision

Pinch is still WebXR `select`. No pose detection and no dwell.

- **One hand, pinch and drag.** What the pinch started on decides what the drag does:
  - **on a part: move the model**;
  - **on empty space: turn it.** Sideways spins it about its vertical axis; up and down tilts it, to 60° at most, so it cannot be flipped over. This is the convention of 3D viewers, and it is the only way to turn the model that needs no depth, which two-hand twist does;
  - **on a toolbar or panel control: nothing.** It never drags.

  A pinch that travels less than 3 cm stays a click. Past that it becomes a drag, and the click it started is dropped. The target is fixed when the pinch starts, so a ray that slides off a part mid-drag does not turn a move into a turn.
- **Two hands, pull apart or push together: one continuous spread.** From closed it explodes first, 25 cm of travel for the full range, exactly as before. Past fully exploded the same pull zooms in, to 2× at most. Pushing together zooms out first and then collapses. Zoom only exists on a fully exploded model: collapsing it by any means returns it to full size.
- **Two hands, rotate: the line between the pinched hands is a handle on the model.**
  - **Turn it like a steering wheel** and the model rolls about the viewer's line of sight. This is the two-hand rotation a single camera can see, so it is the one that works with webcam hands.
  - **Push one hand forward and pull the other back** and it spins about its vertical axis.
  - **Push both hands away or pull them closer** and it tilts about the viewer's left-right axis: pulling tips the top toward you, pushing tips it back, 15 cm for the full 60°. The positions of two hands cannot measure a rotation about the line between them, so this stands in for it. The first 2 cm are ignored.
  - Each rotation trusts only the hand separation it can measure: the spin uses the separation in the horizontal plane, the wheel turn the separation in the plane facing the viewer, and each needs at least 12 cm of it. So a wheel turn past vertical cannot fake a spin.
  - A soft deadzone of about 10° ignores small rotations, so a straight pull does not also turn the model; a deliberate turn then follows the hands one-to-one.
- **Two hands, move together sideways or up and down: carry the model.** Toward and away is the tilt above, so two hands no longer carry the model in depth; a one-hand drag from a part still does.
- **Zoom and turn happen about the model's own centre**, not about the point between the hands. The hands are in front of the model, so a pivot between them throws the model away as it grows.
- **Only the model moves.** The caption, toolbar and evidence panel stay on the anchor. The model is held inside a box around its authored place, and never closer than about 0.35 m to the eyes.
- **Recenter** also resets move, zoom, spin, tilt and roll. Keys in the emulator: `+`/`-` zoom, arrows move, `[`/`]` spin, PageUp/PageDown tilt, `,`/`.` roll, `G` guide.
- The model's rotation is spin about its vertical, then tilt, then roll about the line of sight (Euler order ZXY), so each control does the same thing whatever the others are set to.
- **A gesture guide** is one press away: the **Gestures** button shows a card below the model with one line per gesture, and hides it again. It is not shown by default, so the lessons' own captions stay the only instruction until someone asks.
- **The hand that lets go last** after a two-hand gesture has to pinch again before it can drag.
- **A press needs a real release.** In a session, a press whose ray slides off its target while the pinch is still held is dropped. Before, sliding off counted as a press.

The logic is a pure state machine (`apps/quest/src/app/view-gestures.ts`). `hand-gestures.ts` feeds it pinch state and grip positions and replaces `two-hand-pull.ts`.

### A pointer bug in IWSDK 1.0.1, and the work-around

IWSDK's ray pointer goes from hover to select when a pinch starts on a target. It only goes back if the ray is still on a target when the pinch ends. If the pinch ends with the ray on nothing, the pointer stays in select and **that hand's next pinch is ignored**. Nearly every drag ends that way.

`pointer-unstick.ts` checks each hand every frame. If the hand is not pinching and its ray pointer still says select, it releases the button and sets the state back to normal. It reaches into private fields of `@iwsdk/xr-input`, checks each one, and does nothing if the shape differs. The SDK version is pinned.

## Consequences

- The tutorial's explode and collapse steps are unchanged, and the emulator walkthrough passes in controller and hand mode.
- Move, zoom, turn and tilt have key equivalents in the emulator and a reset button (Recenter), but **no in-world buttons of their own**. That falls short of "every gesture has a button equivalent" ([INTERACTION_SPEC §7](../INTERACTION_SPEC.md)) for anyone who cannot use the gestures.
- A zoomed model can cover the caption and the toolbar. That is the user's choice, and Recenter undoes it.
- A model zoomed until it fills the view leaves little empty space to start a turn from. Two-hand twist and Recenter still work there.
- The work-around depends on SDK internals. An SDK upgrade must re-check it.

## Not known without a headset

- Whether 3 cm is the right drag threshold for real pinches, and whether the palm position moves enough during a real pinch to start a drag by accident.
- Whether the twist deadzone, the 1.5× move gain and the turn and tilt gains feel right.
- Whether pointing at a part to move, and at empty space to turn, is easy enough to tell apart with real hand rays.
- Whether the stuck-pointer bug behaves the same with real hand tracking. It was reproduced and fixed with emulated hands only.

## Revisit trigger

A device test, or any SDK upgrade.
