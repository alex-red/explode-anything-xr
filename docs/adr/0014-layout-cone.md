# ADR-0014: Layout — precomputed, inside a 60°×50° cone

**Status:** Accepted, 2026-10-23

## Context

- The VR Glasses field of view is ~70×66°, versus ~110×96° on Quest 3 ([source](https://developers.meta.com/blog/meta-connect-recap-start-building-the-future-of-vr/)).
- Seated reach is limited.

## Decision

- `Layout` stores collapsed and exploded positions per node, relative to the anchor (~0.65 m ahead).
- Every exploded placement fits within `cone_deg = {horizontal: 60, vertical: 50}` as seen from the head. An automated test checks this (AT-11).
- Interactive targets are within ~0.65 m reach.
- Clusters are spread on a shallow arc; children sit around their cluster.
- No runtime force-directed layout.

## Consequences

The layout is Glasses-safe for free, but limits how many nodes can be visible at once.

## Revisit trigger

The Glasses become a declared platform (P2).

## Note, 2026-11-11

The panels now have field-of-view budgets too (`apps/quest/src/app/fov.ts`), measured like a view frustum around the gaze at the model. **Wide** (default, Quest 3S): model, caption and toolbar within ±46° × ±43°, with evidence and gestures a glance aside. **Narrow** (glasses-class): every panel within ±33° × ±31°, placed by angle from the measured eye, the toolbar reduced to the lesson's buttons. A "Layout" button switches them. The software layout is also spread at build time so no two ray targets overlap (`tools/content/src/layout.ts`), and part labels that would overlap a more important one move up or hide.
