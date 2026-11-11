# ADR-0013: Render budget — sustained 72 Hz, no post-processing

**Status:** Accepted, 2026-10-23. Amended 2026-11-09: batching was applied up front, because no headset is available to measure on. The look built inside this budget is [ADR-0022](0022-hologram-look.md).

## Context

- Quest Browser targets 72 Hz, and WebXR has no SpaceWarp, so any dropped frame shows as judder.
- In three.js every mesh is a draw call, and WebGL lines are always 1 px wide.
- Post-processing is costly and can break passthrough alpha blending.

## Decision

P0 rendering:

- Software nodes are **instanced batches** (clusters, modules, everything else) tinted per instance; each node keeps an invisible hit volume for rays. Mechanical parts stay individual meshes.
- **Edges and flow particles are one instanced batch each.**
- **Labels and panels are CanvasTexture planes**, capped at 18 visible labels.
- Budget: at most 120 draw calls for the app's own content in the worst scene, held by a test (79 measured).
- Fake glow with emissive/additive materials; no post-processing or bloom.
- No per-frame allocations.

**Fallbacks if the Oct 26 perf spike (G2) fails:**

- MSDF text (troika or IWSDK UIKit) instead of canvas textures;
- edges merged into one ribbon mesh driven by vertex attributes;
- instanced nodes;
- ≤40 nodes.

## Consequences

Simple to build. Draw calls grow with the edge count, which must be measured.

## Revisit trigger

G2 fails, or AT-04 fails during polish.

## Note, 2026-11-11

The budget test now also covers the opening scene at its busiest: the headset model on a desk in mixed reality, exploded, its camera link cut and the room dimmed, with the gesture card open. 50 draw calls measured, against the same limit of 120. Frame rate on the Quest 3S is still unmeasured (spike S4).

