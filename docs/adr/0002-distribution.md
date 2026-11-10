# ADR-0002: Distribution — hosted link, frozen production deploy

**Status:** Accepted, 2026-11-09. Replaces the 2026-10-23 decision (Bubblewrap TWA + immutable versioned path).

## Context

- The competition rules say a project built with IWSDK (WebXR) is submitted by sharing a hosted link (GitHub Pages or any host). Only Unity, Unreal, Godot and native entries upload an APK to a "Competition" release channel.
- No changes are allowed after the entry period, and the project must stay available throughout judging.
- Judges therefore open the link in Quest Browser, land on a 2D page, and press a button to enter the session.

## Decision

- **No APK.** Bubblewrap, the signing keystore, `assetlinks.json`, the release channel and the second-account install are all dropped.
- Host on **GitHub Pages**, from the `gh-pages` branch of the public repository `alex-red/explode-anything-xr`: <https://alex-red.github.io/explode-anything-xr/>. The rules name GitHub Pages as the default for IWSDK entries.
- A repository has one Pages site, so the same URL serves iterations until the freeze and is the submitted link after it. `npm run release:pages` publishes the local build.
- The release candidate is published **once**, from a tagged commit, and `release:pages` is never run again.
- `npm run release:manifest` records the SHA-256 of every built file with the commit and both bundle hashes in `release/manifest.json`, which is committed. `npm run release:verify <url>` fetches the deployed files and compares them (AT-13).
- The landing page (`apps/quest/index.html`) is treated as the first screen of the product.

## Consequences

- About two days of packaging and Dashboard work are removed.
- There is no auto-enter: one press on the landing page is always required.
- The freeze rests on not publishing again, checked by `release:verify`. The `gh-pages` branch history is a second record of what was served and when.
- The source, docs and history are public.
- Hosting must stay up until winners are announced.
- The app manifest stays, but the service worker is not registered ([ADR-0016](0016-offline.md)).

## Revisit trigger

The rules or organizers ask WebXR entries for an APK after all. The earlier decision and the `iwsdk-pwa-packaging` skill describe that path.
