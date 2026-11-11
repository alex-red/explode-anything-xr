# ADR-0012: Input — ray + select, custom two-hand pull, a button for everything

**Status:** Accepted, 2026-10-23 · **Amended by:** [ADR-0021](0021-view-manipulation.md) (move, zoom and turn; `two-hand-pull.ts` became `hand-gestures.ts`)

## Context

- "Head-gaze + pinch" is wrong for Quest: Meta treats head gaze as the last fallback ([source](https://developers.meta.com/vr/essentials/horizon-os-input/)).
- Palm pose detection is fragile.
- IWSDK hand pinch does not drive proximity grabs by default ([ADR-0001](0001-engine.md)).

## Decision

- **Far targeting:** `RayInteractable` + `Pressed` (hand ray or controller ray), using WebXR `select` for pinch.
- **Explode:** a custom system tracks both hands' select state and grip/ray-space positions. When both pinches start within ~400 ms and neither ray is on a button, the change in hand distance maps to the explode factor 0→1. Release has ~100 ms of hysteresis.
- **Buttons:** every gesture also has one (Explode/Collapse/Trace/Unplug/Undo/Reset/Next). In the emulator, the keyboard shortcuts are `E`/`C`.
- No dwell and no pose detection.
- **VR Glasses:** gaze + pinch only with the Glasses profile (P2).

## Consequences

Robust on hands and controllers alike, at the cost of less "physical" grabbing than proximity grabs.

## Revisit trigger

The Oct 29 device test (K3), or enabling `useHandPinchForGrab` proves reliable for plug handles.

## Note, 2026-11-11

Room anchoring changes no input. The headset lesson's model shows hand tracking downstream of the cut camera link, but the user's real hands keep working, and the caption says so ([ADR-0024](0024-headset-model-and-dimming.md)). On a desk the stage stands 0.65 m from the eyes, so its parts stay within the same seated reach as the floating placement.
