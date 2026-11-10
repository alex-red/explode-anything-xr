# ADR-0013: Render budget — sustained 72 Hz, no post-processing

**Status:** Accepted, 2026-10-23

## Context

- Quest Browser targets 72 Hz, and WebXR has no SpaceWarp, so any dropped frame shows as judder.
- In three.js every mesh is a draw call, and WebGL lines are always 1 px wide.
- Post-processing is costly and can break passthrough alpha blending.

## Decision

P0 rendering:

- Nodes and parts share geometry and materials per state.
- **Edges are individual tube meshes** sharing geometry and materials.
- **Labels and panels are CanvasTexture planes**, capped at ~30 visible labels.
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
