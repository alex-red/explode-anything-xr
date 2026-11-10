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

In dev, a **Webcam hands** panel sits at the bottom right. Pick a camera, press **Start**, allow
the camera, then enter XR. Your camera, left/right swap and reach calibration are remembered in
this browser. If the webcam was running when the page reloaded, it starts again. `?webcam` in
the URL also starts it on load. While it runs, IWER is in programmatic control mode, the same
mode the CLI walkthrough uses. Otherwise the IWER dev UI would overwrite the hands every frame.
Its mouse and keyboard controls come back on **Stop**. The bridge re-asserts that mode every
frame, because IWER's remote layer (the CLI) drops it when idle, and Stop leaves the mode alone
while the CLI holds the device. Code:
`src/dev/webcam-hands.ts` (bridge) and `src/dev/webcam-hands-map.ts` (pure mapping, tested in
`test/webcam-hands-map.test.ts`).

- Your hand is a screen pointer. Where your palm is in the camera frame picks a direction from
  your eyes. The emulated hand sits on that line of sight and its ray carries straight on, so a
  pinch clicks whatever is behind the hand on screen. The middle of the frame points a little
  below straight ahead.
- Pinching thumb and index finger is a WebXR select. The pinch is an on/off switch: it presses
  when the fingertip gap is under about 2.5 cm for two frames, and releases when it is over about
  3.5 cm for six frames in a row (about 0.2 s). Releasing is slower on purpose: while pinched
  hands move, the tracker reads them as open for a frame or two, and a dropped pinch ends a drag
  or a two-hand gesture. The panel shows each hand's gap.
- A click is held steady. On pinch, the pointer goes back to where it was just before your
  fingers started closing and freezes until you let go. The app presses a button on release, and
  only if the ray is still on it.
- Holding a pinch for more than 0.6 s, or pinching with both hands, unfreezes the pointer. Then a
  held pinch drags: from a part it moves the model, from empty space it turns it. Two hands
  pinched and pulled apart explode and then zoom; turned like a steering wheel they roll the
  model, which is the two-hand rotation a webcam sees best. Pushing both hands toward the camera
  or pulling them back tilts it; that uses the smoothed palm-size depth estimate, so it is
  coarser. The forward/back spin needs real depth.
- How big your hand looks sets how far along the line of sight the hand sits (30-60 cm), measured
  against its size when tracking starts.
- Each press and release is logged to the console as `[explode:webcam]`, with the gap, the pointer
  position and the hand pose.
- **H** swaps left and right (`?webcam=swap` starts swapped), and **K** recalibrates reach:
  hold your hands at a comfortable distance and press K.
- MediaPipe Hand Landmarker 0.10.14 and its model load from jsdelivr and Google Storage. Camera
  frames are processed in the page and go nowhere.
- The bridge only loads when `import.meta.env.DEV` is true, so the release build doesn't include it.
- The managed IWSDK browser may block camera access. If so, open the same localhost URL in
  ordinary Chrome; IWER still activates on localhost.

This is a rough stand-in. It doesn't reproduce Quest tracking quality, depth, latency or finger
joints, so anything learned with it counts as emulator-only.
