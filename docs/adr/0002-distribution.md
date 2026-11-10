# ADR-0002: Distribution — Bubblewrap TWA + immutable static deploy

**Status:** Accepted, 2026-10-23

## Context

A Quest PWA APK is a thin wrapper that loads a live URL ([Meta PWA packaging](https://developers.meta.com/vr/documentation/web/pwa-packaging/)). The rules require that judges can access the build until the winners are announced (~Dec 11), with no updates after the deadline.

## Decision

- Package with Meta's Bubblewrap flow (see `apps/quest/.claude/skills/iwsdk-pwa-packaging`).
- Host statically on a CDN (Cloudflare Pages or similar), alongside the tutor Worker.
- Each release candidate deploys to an **immutable versioned path** `/v/<semver>-<hash8>/`, and `start_url` points there.
- Serve `assetlinks.json` from the root.
- Back up the signing keystore offline and never commit it.

## Consequences

- An extra deploy step is needed for `assetlinks.json`.
- Hosting must stay up through Dec 11.
- The freeze is enforced by convention plus a daily hash check (AT-13).

## Revisit trigger

The Dashboard rejects the PWA upload, or a "Competition" channel cannot be created.
