# ADR-0019: Assets — procedural only

**Status:** Accepted, 2026-10-23

## Context

Every PWA asset is a publicly downloadable file. Many asset licenses (possibly including the Meta Asset Library's, **VERIFY**) forbid redistributing raw files.

## Decision

- Drivetrain parts are built procedurally from `AssetManifest.parts` (box, cylinder, sphere, torus, gear) at runtime.
- No third-party meshes or textures in P0.
- Fonts, SFX and narration are recorded in [DATA_PROVENANCE.md](../DATA_PROVENANCE.md).

## Amendment, 2026-11-12: procedural textures

The Jupiter model paints its own textures at runtime (`apps/quest/src/app/looks/jupiter-paint.ts`): the cloud map, a row of depth colours and a tile of fine streaks, all computed from a seed. Nothing is downloaded and no image file ships, so the decision above stands: still no third-party meshes or textures. A painted texture is an illustration, and the model statement says the clouds are "painted by rule, not imaged".

## Consequences

- Small download and no licensing risk.
- A stylized look.

## Revisit trigger

A licensed asset is confirmed redistributable and is clearly better.
