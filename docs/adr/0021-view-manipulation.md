# ADR-0021: Handling the model with the hands — move, zoom and turn on top of the two-hand pull

**Status:** Accepted, 2026-11-10 · **Amends:** [ADR-0012](0012-input.md)

## Context

- The exploded view could only be opened and closed. Looking closely at one part of it, or getting it out of the way of a panel, meant moving your head.
- Two hands pulling apart already means "explode" ([ADR-0012](0012-input.md)), and the lessons depend on it. The usual meaning of that gesture elsewhere is "zoom".
- The content is always farther away than the hands ([INTERACTION_SPEC §1](../INTERACTION_SPEC.md)).
- There is no headset: all of this was built and checked in the IWER emulator.

## Decision

Pinch is still WebXR `select`. No pose detection and no dwell.

- **One hand, pinch and drag: move the model.** A pinch that travels less than 3 cm stays a click. Past that it becomes a drag, and the click it started is dropped. A pinch that starts on a toolbar or panel control never drags.
- **Two hands, pull apart or push together: one continuous spread.** From closed it explodes first, 25 cm of travel for the full range, exactly as before. Past fully exploded the same pull zooms in, to 2× at most. Pushing together zooms out first and then collapses. Zoom only exists on a fully exploded model: collapsing it by any means returns it to full size.
- **Two hands, twist: turn the model about its vertical axis.** Twist counts only while the hands are at least 12 cm apart and past a 10° deadzone, so a straight pull does not also turn it.
- **Two hands, move together: carry the model.**
- **Zoom and turn happen about the model's own centre**, not about the point between the hands. The hands are in front of the model, so a pivot between them throws the model away as it grows.
- **Only the model moves.** The caption, toolbar and evidence panel stay on the anchor. The model is held inside a box around its authored place, and never closer than about 0.35 m to the eyes.
- **Recenter** also resets move, zoom and turn. Keys in the emulator: `+`/`-` zoom, arrows move, `[`/`]` turn.
- **The hand that lets go last** after a two-hand gesture has to pinch again before it can drag.
- **A press needs a real release.** In a session, a press whose ray slides off its target while the pinch is still held is dropped. Before, sliding off counted as a press.

The logic is a pure state machine (`apps/quest/src/app/view-gestures.ts`). `hand-gestures.ts` feeds it pinch state and grip positions and replaces `two-hand-pull.ts`.

### A pointer bug in IWSDK 1.0.1, and the work-around

IWSDK's ray pointer goes from hover to select when a pinch starts on a target. It only goes back if the ray is still on a target when the pinch ends. If the pinch ends with the ray on nothing, the pointer stays in select and **that hand's next pinch is ignored**. Nearly every drag ends that way.

`pointer-unstick.ts` checks each hand every frame. If the hand is not pinching and its ray pointer still says select, it releases the button and sets the state back to normal. It reaches into private fields of `@iwsdk/xr-input`, checks each one, and does nothing if the shape differs. The SDK version is pinned.

## Consequences

- The tutorial's explode and collapse steps are unchanged, and the emulator walkthrough passes in controller and hand mode.
- Move, zoom and turn have key equivalents in the emulator and a reset button (Recenter), but **no in-world buttons of their own**. That falls short of "every gesture has a button equivalent" ([INTERACTION_SPEC §7](../INTERACTION_SPEC.md)) for anyone who cannot use the gestures.
- A zoomed model can cover the caption and the toolbar. That is the user's choice, and Recenter undoes it.
- The work-around depends on SDK internals. An SDK upgrade must re-check it.

## Not known without a headset

- Whether 3 cm is the right drag threshold for real pinches, and whether the palm position moves enough during a real pinch to start a drag by accident.
- Whether the twist deadzone and the 1.5× move gain feel right.
- Whether the stuck-pointer bug behaves the same with real hand tracking. It was reproduced and fixed with emulated hands only.

## Revisit trigger

A device test, or any SDK upgrade.
