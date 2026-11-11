# ADR-0024: Open on the headset you are wearing, and dim the real room when its camera link is cut

**Status:** Accepted, 2026-11-11 · **Plan:** [WIN_PLAN.md](../WIN_PLAN.md) §4, W2–W4 · **Truth contract:** [ADR-0007](0007-evidence.md)

## Context

- The opening tutorial was an EV drivetrain. It taught the gestures well but had nothing to do with the room or the device, and the lesson played the same with passthrough off.
- Every judge wears the same kind of device. A model of it is the most personal first payoff we can offer, and it lets the room become the subject of a lesson instead of a backdrop.
- The rules forbid brand names used as advertising, logos and "recognizable branded products" (WIN_PLAN decision D1).

## Decision

**The model.** `content/headset` is an authored procedural spec in the drivetrain's format: nine parts (front cameras, processor board, battery, display, two lenses, speakers, front shell, facial interface) and one path, `path:room-to-eye`, from the cameras through the board and display to the lenses. Its seven-step lesson is explode → trace → unplug the camera link → predict → observe → repair → collapse, and it ends by handing over to the codebase. The generator builds it with the drivetrain's builder (`tools/content/src/authored.ts`).

**It opens the app.** The headset lesson is the first tutorial; the drivetrain stays, one press away under the toolbar's "More". Nothing that worked was deleted.

**Truth.** Every part and connection is `authored_model`, never promoted. The model statement says it is "a simplified, stylized teaching model … not the device's actual internals … Not affiliated with or endorsed by Meta." The device is named in plain text only; there is no logo, wordmark, product image or replica of its industrial design. Part cards carry no specification figures until each has a source in [DATA_PROVENANCE.md](../DATA_PROVENANCE.md).

**The dimming break.** When the camera link is cut, and only once the learner has made their prediction (dimming earlier would give the answer away), the real room fades to about 90 % dark over roughly half a second, using the existing backdrop ([ADR-0022](0022-hologram-look.md)). The caption says at the same moment: "We dimmed your view of the room to show what this link carries. Your headset is fine, and your hands still work." Repairing the link fades the room back. The viewer's own View setting is kept and shown unchanged.

- It happens only in a mixed-reality session that shows the room: never on the 2D page, and never over the virtual backdrop of a VR session, where the model alone goes dark.
- A sound marks the dimming and its return ([ADR-0015](0015-audio.md)).
- The app never says or implies that it changed the headset; the dimming is labelled as an illustration while it is shown.

## Consequences

- The lesson cannot play the same with passthrough off: the room is what the break takes away. That is the strongest answer we have to "the real room must change the experience".
- The drivetrain lesson is still covered by tests and reachable, so a judge who skips around loses nothing.
- If the sponsor rules the plain-text name out, the fallback is a text change ("a headset like the one you're wearing"); the model needs no change.
- Unverified: whether the dimming is comfortable and reads as intended over real passthrough (spike S3), and whether the model reads clearly at desk distance on the 3S.

## Revisit trigger

Spike S3 on the headset, a ruling on D1, or a playtester who reads the dimming as a malfunction.
