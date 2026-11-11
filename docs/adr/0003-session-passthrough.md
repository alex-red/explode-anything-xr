# ADR-0003: Session — immersive AR, passthrough-first, seated

**Status:** Accepted, 2026-10-23

## Context

- The handoff specified a fully virtual "observatory".
- Passthrough MR on Quest 3 is cheaper to build, more comfortable when seated, and fits the Productivity track.
- Meta's guidelines favor seated sessions, fast entry/exit, and clean pause/resume ([source](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)).

## Decision

- `iwsdk.config.json` sets `world.xr.mode = "ar"` with `handTracking: true`.
- Locomotion, physics and scene understanding are off.
- Seated `local` reference space with a recenter button.
- Backdrop toggle (P1): passthrough → dimmed → virtual.
- No depth sensing in P0.

## Consequences

- Little environment art is needed.
- Virtual content draws over real hands, so content sits just beyond hand reach.
- Captures show the user's room.

## Revisit trigger

Passthrough is missing from captures (Oct 26), or AR mode triggers a space-setup prompt that breaks cold start.

## Note, 2026-11-11

Scene understanding is now on: plane detection, mesh detection and anchors are requested as optional features, so a refusal still starts the session. The stage stands on a detected desk and remembers its spot, with the floating placement as the fallback ([ADR-0023](0023-room-anchoring.md)). The backdrop also serves the headset lesson's dimming illustration ([ADR-0024](0024-headset-model-and-dimming.md)).
