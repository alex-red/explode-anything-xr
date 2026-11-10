# IWSDK App

This project uses `iwsdk.config.json` for declarative scene, asset, component,
XR, and emulator configuration. Application systems remain explicit in
`src/index.ts`.

```sh
bun install
bun run dev
```

Use the Runtime and Editor controls in the managed browser to switch between
the running experience and its authored scene.

## Starter content

The robot and welcome panel are small examples of authored scene content plus
runtime systems. The robot turns toward the player's head and plays a sound
when pressed. To remove the robot, delete its scene node, its `RobotSystem`
registration from `src/index.ts` or `src/index.js`, and its `Robot` registration
from `src/components.ts` or `src/components.js`; you can then delete the unused
robot component and system files. To remove the welcome panel, delete its scene
node and its `PanelSystem` registration from the application entry point.

- Minimal scene walkthrough: https://iwsdk.dev/guides/01b-minimal-scene.html
- XR-enabled projects — IWER emulator controls: https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls

## Webcam hands (dev only)

To drive the emulated hands with your own hands, open the dev server URL with `?webcam`
added (for example `https://localhost:8473/?webcam`), allow the camera, then enter XR. Code:
`src/dev/webcam-hands.ts` (bridge) and `src/dev/webcam-hands-map.ts` (pure mapping, tested in
`test/webcam-hands-map.test.ts`).

- Your palm position in the frame moves the hand left/right and up/down. How big your hand looks
  sets the reach, measured against its size when tracking starts.
- Pinching thumb and index finger is a WebXR select, using IWER's own thresholds. Two hands
  pinched and pulled apart do the explode.
- The ray runs from an estimated shoulder through your hand.
- **H** swaps left and right (`?webcam=swap` starts swapped), and **K** recalibrates reach:
  hold your hands at a comfortable distance and press K.
- MediaPipe Hand Landmarker 0.10.14 and its model load from jsdelivr and Google Storage. Camera
  frames are processed in the page and go nowhere.
- The bridge only loads when `import.meta.env.DEV` is true, so the release build doesn't include it.
- The managed IWSDK browser may block camera access. If so, open the same localhost URL in
  ordinary Chrome; IWER still activates on localhost.

This is a rough stand-in. It doesn't reproduce Quest tracking quality, depth, latency or finger
joints, so anything learned with it counts as emulator-only.
