# ADR-0019: Assets — procedural only

**Status:** Accepted, 2026-10-23

## Context

Every PWA asset is a publicly downloadable file. Many asset licenses (possibly including the Meta Asset Library's, **VERIFY**) forbid redistributing raw files.

## Decision

- Drivetrain parts are built procedurally from `AssetManifest.parts` (box, cylinder, sphere, torus, gear) at runtime.
- No third-party meshes or textures in P0.
- Fonts, SFX and narration are recorded in [DATA_PROVENANCE.md](../DATA_PROVENANCE.md).

## Consequences

- Small download and no licensing risk.
- A stylized look.

## Revisit trigger

A licensed asset is confirmed redistributable and is clearly better.
