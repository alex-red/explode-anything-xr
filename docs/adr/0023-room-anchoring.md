# ADR-0023: The stage stands on the real desk, remembers its spot, and falls back to floating

**Status:** Accepted, 2026-11-11 · **Amends:** [ADR-0003](0003-session-passthrough.md) · **Plan:** [WIN_PLAN.md](../WIN_PLAN.md) W1, W4

## Context

- The judging criteria name scene understanding, anchoring to detected planes, persistent anchors and "the real room must change the experience". Until now the model floated in front of the eyes, and the lesson played the same with passthrough off.
- A browser on a Quest sees the room only through what the user set up in the headset: planes (floor, walls, tables) and labelled boxes, through WebXR plane detection, mesh detection and anchors. IWSDK 1.0.1 exposes these through `SceneUnderstandingSystem`. Camera pixels are not available to us ([WIN_PLAN §3](../WIN_PLAN.md#3-what-a-browser-on-a-quest-can-actually-see)).
- A judge may have no room setup, may refuse the permission, or may sit at a table we never tested. The app has to work in every one of those cases.

## Decision

**Request, never require.** `iwsdk.config.json` asks for plane detection, mesh detection and anchors as optional features. A headset that refuses them still starts the session.

**Choose the desk** (`surface-pick.ts`, pure and tested; `room.ts` reads the planes). A surface qualifies when it is horizontal, not a floor, wall, ceiling, door or window, at least 30 × 30 cm, 0.25–0.65 m below the eyes (a seated viewer; this also rules out the floor and a standing viewer), and reachable in front of them. The stage centre is pulled onto the surface, inset from its edge, at 0.65 m in front of the eyes, close to the floating distance. Tables and desks score a little better. Planes that arrive within 3 s of the session starting still move a stage that is floating.

**Fall back at every level.** No session, a virtual (opaque) backdrop, no planes, no qualifying surface, or a refused permission: the stage floats 0.7 m ahead and 0.14 m below the eyes, exactly as before.

**Panels respect the surface.** On a desk the toolbar rises so its lowest button clears the surface, and the gesture card lies on the desk tipped toward the eyes.

**Remember the spot** (`desk-memory.ts`). IWSDK keeps one persistent anchor at the origin of the reference space and restores it in later sessions. A desk placement is saved as a pose relative to that anchor, with the anchor's id. In the next session, once the SDK has restored the same anchor (within 6 s of the session starting), the stage returns to that pose. A different or missing anchor means a fresh pick. Recenter always picks again and replaces the memory; the reset key forgets it and places the stage afresh.

Reaching the anchor reads two private SDK fields (`xrAnchor`, `anchoredGroup`). `SdkAnchorFrame` checks each one and reports "no anchor" if the shape differs, and it waits three frames before trusting the group's pose. Like [pointer-unstick.ts](../../apps/quest/src/app/pointer-unstick.ts), re-check it if the SDK version changes.

**Debugging the real room.** With `?debug`, Recenter logs every detected surface (`[explode:surfaces]`: label, height, size, position).

## Consequences

- The first thing a judge sees can stand on their own desk. The lesson's dimming beat ([ADR-0024](0024-headset-model-and-dimming.md)) then uses the room as its subject.
- A wrong pick is cheap to escape: Recenter, or move the model by hand ([ADR-0021](0021-view-manipulation.md)).
- What the emulator shows: in its `living_room`, seated at eye height 1.2 m, the stage stands on the 0.79 m table, and it returns there in the next session. At the emulator's default standing height no desk is picked, by design. The emulator restores its anchor in an unchanged reference space, so persistence across real sessions is **unverified**.

## Revisit trigger

Spike S2 on the Quest 3S: which labels and sizes the room setup really returns, whether the anchor persists across sessions, and how often the pick lands somewhere odd.
