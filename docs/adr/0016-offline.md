# ADR-0016: Offline and persistence

**Status:** Accepted, 2026-10-23

## Context

- Judges may have unreliable networks.
- Sessions can be blurred, hidden or killed.

## Decision

- Bundles are imported statically, so they are part of the app build and precached by the service worker. All assets total ≤30 MB.
- A designed "connect once" screen covers a first launch with no network.
- **The event log is persisted to `localStorage`**, wrapped in try/catch, after each event, and replayed on relaunch. IndexedDB is used only if the log grows past localStorage limits.
- Animations and audio pause on `VisibleBlurred`/`Hidden`.

## Consequences

- Restore is trivial thanks to deterministic replay ([ADR-0009](0009-lesson-engine.md)).
- Storage may be unavailable, in which case the app runs without persistence.

## Revisit trigger

The log exceeds ~1 MB, or storage proves unreliable on device.
