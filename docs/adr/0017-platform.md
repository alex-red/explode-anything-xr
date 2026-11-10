# ADR-0017: Platform — submit for Quest 3/3S only

**Status:** Accepted, 2026-10-23

## Context

- The competition accepts Quest, VR Glasses, or both.
- The Glasses ship in spring 2027, with eyes + hands as primary input ([source](https://developers.meta.com/blog/meta-connect-recap-start-building-the-future-of-vr/)).
- Eye gaze can't be tested on a Quest 3.

## Decision

- Declare Quest 3/3S only.
- Respect the Glasses field of view in the layout ([ADR-0014](0014-layout-cone.md)).
- Glasses gaze + pinch is P2, claimed only if tested in the emulator's Glasses profile (K8).

## Consequences

No unsupported claims, at the cost of possibly missing Glasses-oriented appeal.

## Revisit trigger

Gaze is tested in the emulator and time allows.
