# ADR-0001: Engine — Immersive Web SDK (WebXR) PWA

**Status:** Accepted, 2026-10-23

## Context

- The developer works alone, is strong in TypeScript and the web, is new to Unity/XR, works only on macOS, and has no headset yet.
- Meta's competition post lists **web** as an allowed engine ([source](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)).
- IWSDK is MIT-licensed and built on three.js. It ships an ECS, grab and ray interactions, the IWER emulator (runs on a Mac), and agent tooling ([IWSDK](https://iwsdk.dev)).

## Decision

- Use **`@iwsdk/core` 1.0.1**, pinned. It is the latest stable release (2026-10-01). `1.1.0-rc.*` is not used.
- `three` is aliased to `npm:super-three@0.181.0`, as IWSDK requires.
- The app was scaffolded with `@iwsdk/create` 1.0.1 (`--target ar`) into `apps/quest`.

Interaction facts that shape the design:

- `GrabSystem.useHandPinchForGrab` defaults to **false**.
- `OneHandGrabbable` and `TwoHandsGrabbable` are proximity grabs that respond to **squeeze**. `DistanceGrabbable` is ray-based and responds to **trigger**.

P0 interactions are therefore **ray + `select` (pinch)** using `RayInteractable`/`Pressed`, plus a custom two-hand pinch-pull for explode ([ADR-0012](0012-input.md)).

## Consequences

- One language across the whole stack.
- Fast iteration on a Mac in the emulator, then on device via `adb reverse`.
- Performance is lower than native, with no SpaceWarp ([ADR-0013](0013-render-budget.md)).
- Depends on PWA eligibility (**VERIFY**).

## Revisit trigger

Either of these triggers a switch to Unity 6 (6000.0.66f2+) with Meta XR SDK v207, cutting the drivetrain tutorial at once:

- Devpost explicitly rejects PWA/web entries (K1, Oct 26).
- The perf spike fails even with the K2 cuts.

Content JSON and the pure engine port over as-is.
