# ADR-0016: Offline and persistence

**Status:** Accepted, 2026-10-23. Amended 2026-11-09: offline relaunch is P1 and the service worker is not registered.

## Context

- Judges may have unreliable networks.
- Sessions can be blurred, hidden or killed.

## Decision

- Bundles are imported statically, so they are part of the app build. Once the page has loaded, the lesson needs no network.
- **Offline relaunch is P1.** With a link-based entry ([ADR-0002](0002-distribution.md)) a judge needs the network to open the page at all. The service worker in `public/sw.js` precaches only `index.html`, so it is not registered. Registering it again needs a build-time precache list and a cache name derived from the build hash.
- There is no "connect once" screen: a page that has never loaded cannot show one.
- **The event log is persisted to `localStorage`**, wrapped in try/catch, after each event, and replayed on relaunch. IndexedDB is used only if the log grows past localStorage limits.
- Animations and audio pause on `VisibleBlurred`/`Hidden`.

## Consequences

- Restore is trivial thanks to deterministic replay ([ADR-0009](0009-lesson-engine.md)).
- Storage may be unavailable, in which case the app runs without persistence.

## Revisit trigger

The log exceeds ~1 MB, or storage proves unreliable on device.
