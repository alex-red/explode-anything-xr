# ADR-0022: A hologram look, built from shaders and additive glow instead of post-processing

**Status:** Accepted, 2026-11-10 · **Builds on:** [ADR-0013](0013-render-budget.md)

## Context

- The scene read as a plain diagram: flat-shaded shapes, grey tubes, rounded dark panels. It worked, but it did not look like something you would want to reach into.
- The reference is the projected, hand-driven diagrams of the Iron Man films, pushed toward cyberpunk: light you can see through, bright edges, moving energy.
- [ADR-0013](0013-render-budget.md) still holds: no post-processing and no bloom (they cost frames on Quest and can break passthrough blending), at most 120 draw calls, no per-frame allocation.
- Colour carries meaning ([INTERACTION_SPEC §4](../INTERACTION_SPEC.md)), so the restyle may not blur it.

## Decision

Everything lives in `apps/quest/src/app/holo.ts` and animates from one shared clock uniform.

| Element | How | Draw calls |
|---|---|---|
| **Bodies** (parts and nodes) | One shader: dark translucent facets (normals from screen-space derivatives), a bright rim, fine scanlines drifting up, a slow sweep band, a slight flicker | unchanged |
| **Halos** | One instanced batch of camera-facing additive quads behind nodes and flow pulses. This is the stand-in for bloom | +1 |
| **Edges** | Energy conduits with a hot core. A per-edge flag turns on travelling pulses | unchanged |
| **Stage** | A projector disc under the model (rings, ticks, dashed rings turning, a scanner wedge) and a faint beam rising from its rim. It turns and zooms with the model | +2 |
| **Boot-up** | A new model materialises from the stage upward behind a bright scan front, in 1.3 s | 0 |
| **Panels** | Dark glass plates with two cut corners, a glowing edge and corner brackets, drawn once into the existing canvas textures | unchanged |
| **Backdrop** (dimmed and virtual views only) | Deep navy, a glowing horizon and a perspective floor grid, in the existing sphere's shader | unchanged |

Rules that keep it honest and readable:

- **State colours keep their meaning.** Gold is the traced path, coral is disconnected or stopped, teal is the user's action. Neutral parts are the hologram's own blues, with violet for routes.
- **Moving light on an edge means traced flow, and nothing else.** Only traced-path edges get travelling pulses; every other edge just breathes. Halos are strongest on selected, traced and stopped nodes.
- **Panels stay dark and nearly opaque** behind text, so captions and evidence read over a bright room.
- No new per-frame allocation. The halo and stage add three draw calls; the budget test still holds the worst scene under 120.

## Consequences

- More blending per pixel than before: translucent bodies, additive halos, the stage and its beam. **This raises fill cost, and the effect on Quest frame rate is unknown without a headset.**
- If it costs too much on device, the cheapest cuts, in order: the beam, the resting halo on every node (keep state halos), the scanlines.
- Translucent instanced bodies are not depth-sorted, so overlapping nodes can blend in either order. It reads as hologram, not as error.
- The emulator's pale room washes the glow out; it is at its best over a darker room or the dimmed and virtual views.

## Not known without a headset

- Frame rate, as above.
- How the additive glow composites over real passthrough, and whether the scanlines shimmer at headset resolution.

## Revisit trigger

A device test, or AT-04 (frame rate) failing.
