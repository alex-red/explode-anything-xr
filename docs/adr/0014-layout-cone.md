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
