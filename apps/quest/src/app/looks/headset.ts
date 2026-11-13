import { BoxGeometry, Shape } from '@iwsdk/core';
import type { PartShape } from '@explode/contracts';
import { Assembly, circleHole, cyl, lathe, ring, roundedBox, roundedRect, slab, type Finish } from './kit.ts';
import type { LookBuilder } from './look.ts';

/**
 * The mixed-reality headset, styled after a current standalone headset: a soft white visor with
 * dark glass sensor pods, a green board with its system-on-chip under a metal lid, a foil pouch
 * battery, the display stack with its amber flex cable, pancake lenses in black barrels, and a
 * fabric facial interface. Front is +z (toward the viewer), as in the spec; the eyes are at -z.
 * Illustrative, like the teaching model it draws: not the device's real internals.
 */
const SHELL: Finish = { name: 'visor-plastic', color: 0xeceef0, metalness: 0, roughness: 0.5, clearcoat: 0.25 };
const TRIM: Finish = { name: 'trim', color: 0x6c7178, metalness: 0.1, roughness: 0.55 };
const GLOSS_BLACK: Finish = { name: 'gloss-black', color: 0x0a0b0d, metalness: 0.1, roughness: 0.12, clearcoat: 1 };
const SENSOR_GLASS: Finish = { name: 'sensor-glass', color: 0x1a2b45, metalness: 0.3, roughness: 0.05, clearcoat: 1, envIntensity: 1.6 };
const BRIGHT_RING: Finish = { name: 'lens-ring', color: 0xb9bec4, metalness: 1, roughness: 0.25 };
const PCB: Finish = { name: 'pcb', color: 0x1d5a3e, metalness: 0.05, roughness: 0.45, clearcoat: 0.5 };
const CHIP: Finish = { name: 'chip', color: 0x141619, metalness: 0.2, roughness: 0.4 };
const LID: Finish = { name: 'chip-lid', color: 0xc0c5ca, metalness: 1, roughness: 0.3 };
const GOLD: Finish = { name: 'gold', color: 0xd9ab48, metalness: 1, roughness: 0.25 };
const PASSIVES: Finish = { name: 'passives', color: 0x9c8a6c, metalness: 0.2, roughness: 0.5 };
const FOIL: Finish = { name: 'pouch-foil', color: 0xc8ccd2, metalness: 0.9, roughness: 0.32 };
const LABEL: Finish = { name: 'label', color: 0x22252a, metalness: 0, roughness: 0.6 };
const NICKEL: Finish = { name: 'nickel', color: 0xa9adb2, metalness: 1, roughness: 0.35 };
const FRAME: Finish = { name: 'display-frame', color: 0x1c1d20, metalness: 0.6, roughness: 0.4 };
const SCREEN: Finish = { name: 'screen', color: 0x05070a, metalness: 0.2, roughness: 0.08, clearcoat: 1, emissive: 0x3d78c4, emissiveIntensity: 0.55 };
const FLEX: Finish = { name: 'flex-cable', color: 0xc47f2c, metalness: 0.3, roughness: 0.38 };
const LENS_GLASS: Finish = { name: 'lens-glass', color: 0xe6eef4, metalness: 0, roughness: 0.04, clearcoat: 1, opacity: 0.32, envIntensity: 1.8 };
const BARREL: Finish = { name: 'lens-barrel', color: 0x131417, metalness: 0, roughness: 0.55 };
const SPEAKER: Finish = { name: 'speaker', color: 0x1a1b1e, metalness: 0, roughness: 0.65 };
const GRILLE: Finish = { name: 'grille', color: 0x3d4148, metalness: 0.8, roughness: 0.4 };
const FOAM: Finish = { name: 'foam-fabric', color: 0x2a2c30, metalness: 0, roughness: 1, sheen: 1 };

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const HALF = Math.PI / 2;

function shell(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  // A soft visor: rounded outline, a thick bevel so the front face reads as curved.
  const a = new Assembly().add(SHELL, slab(roundedRect(new Shape(), w * 0.94, h * 0.9, h * 0.36) as Shape, d * 0.8, d * 0.3, 16), [0, 0, d * 0.05]);
  // Strap hinges on each side, and a thin seam where the visor meets the body.
  for (const s of [-1, 1]) a.add(TRIM, roundedBox(0.008, h * 0.32, d * 0.7, 0.003), [s * (w / 2 - 0.004), 0, -d * 0.05]);
  a.add(TRIM, slab(roundedRect(new Shape(), w * 0.9, h * 0.86, h * 0.34) as Shape, d * 0.25, 0.0003, 16), [0, 0, -d * 0.36]);
  return a;
}

function cameras(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const a = new Assembly();
  // Two dark glass pods, each with a tracking camera and a colour camera, and a depth sensor between.
  for (const s of [-1, 1]) {
    const x = s * w * 0.34;
    a.add(GLOSS_BLACK, roundedBox(w * 0.3, h * 0.95, d * 0.5, h * 0.45, 0.0012), [x, 0, -d * 0.1]);
    for (const dx of [-0.009, 0.009]) {
      a.add(BRIGHT_RING, ring(0.0034, 0.0044, 0.0012, 20), [x + dx, 0, d * 0.18], [HALF, 0, 0]);
      a.add(SENSOR_GLASS, lathe([[0, 0], [0.0035, 0], [0.003, 0.0012], [0, 0.0016]], 20), [x + dx, 0, d * 0.14], [HALF, 0, 0]);
    }
  }
  a.add(GLOSS_BLACK, roundedBox(w * 0.16, h * 0.6, d * 0.4, h * 0.3, 0.001), [0, 0, -d * 0.15]);
  a.add(SENSOR_GLASS, cyl(0.0022, 0.0012, 14), [0, 0, d * 0.08], [HALF, 0, 0]);
  return a;
}

function board(p: PartShape): Assembly {
  const [w, h] = p.size;
  // The board with a notch at the bottom for the nose.
  const outline = roundedRect(new Shape(), w, h, 0.004) as Shape;
  outline.holes.push(circleHole(0.0018, -w * 0.44, h * 0.38), circleHole(0.0018, w * 0.44, h * 0.38));
  const a = new Assembly().add(PCB, slab(outline, 0.0016, 0.0003, 6));
  a.add(CHIP, roundedBox(0.022, 0.022, 0.0022, 0.0015, 0.0003), [0, h * 0.06, 0.0019]);
  a.add(LID, roundedBox(0.017, 0.017, 0.0008, 0.0015, 0.0002), [0, h * 0.06, 0.0033]);
  for (const s of [-1, 1]) a.add(CHIP, roundedBox(0.013, 0.01, 0.0014, 0.0008, 0.0002), [s * w * 0.27, h * 0.12, 0.0015]);
  a.add(CHIP, roundedBox(0.011, 0.011, 0.0012, 0.0006, 0.0002), [-w * 0.3, -h * 0.22, 0.0014]);
  a.add(GOLD, box(0.022, 0.0035, 0.0003), [w * 0.2, -h * 0.4, 0.001]);
  for (let i = 0; i < 6; i++) a.add(GOLD, box(0.0012, 0.0024, 0.0004), [-w * 0.05 + i * 0.0022, -h * 0.4, 0.001]);
  // Small passives scattered round the chip, in a fixed pattern.
  for (let i = 0; i < 26; i++) {
    const t = i * 2.399963;
    const r = 0.016 + (i % 5) * 0.0028;
    a.add(PASSIVES, box(0.0016, 0.0009, 0.0008), [Math.cos(t) * r * 1.4, h * 0.06 + Math.sin(t) * r * 0.9, 0.0012]);
  }
  return a;
}

function battery(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  return new Assembly()
    .add(FOIL, roundedBox(w, h, d * 0.86, 0.004, d * 0.3))
    .add(LABEL, roundedBox(w * 0.7, h * 0.62, 0.0004, 0.002, 0.0001), [0, -h * 0.04, d * 0.44])
    .add(GOLD, box(w * 0.7, h * 0.05, 0.0005), [0, h * 0.18, d * 0.445])
    .add(NICKEL, box(0.006, 0.006, 0.0006), [-w * 0.2, h / 2 + 0.002, 0])
    .add(NICKEL, box(0.006, 0.006, 0.0006), [w * 0.2, h / 2 + 0.002, 0]);
}

function display(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const a = new Assembly().add(FRAME, roundedBox(w, h, d * 0.6, 0.006, 0.0008), [0, 0, d * 0.1]);
  // One panel per eye on the eye side (-z), and the flex cable folded over the back.
  for (const s of [-1, 1]) a.add(SCREEN, roundedBox(w * 0.43, h * 0.82, 0.0012, 0.004, 0.0003), [s * w * 0.235, 0, -d * 0.25]);
  a.add(FLEX, box(w * 0.18, h * 0.5, 0.0006), [0, -h * 0.05, d * 0.42]);
  a.add(FLEX, box(w * 0.08, h * 0.32, 0.0006), [0, -h * 0.45, d * 0.42]);
  a.add(GOLD, box(w * 0.06, h * 0.06, 0.0007), [0, -h * 0.58, d * 0.44]);
  return a;
}

function lens(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const t = p.size[1];
  // A pancake lens: two shallow convex faces in a black barrel.
  const glass: Array<[number, number]> = [[0, -t * 0.42], [r * 0.5, -t * 0.36], [r * 0.85, -t * 0.22], [r * 0.86, t * 0.22], [r * 0.5, t * 0.36], [0, t * 0.42]];
  return new Assembly().add(LENS_GLASS, lathe(glass, 40)).add(BARREL, ring(r * 0.84, r, t, 40)).add(BARREL, ring(r * 0.78, r * 0.9, t * 0.18, 40), [0, t * 0.46, 0]);
}

function speakers(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const a = new Assembly().add(SPEAKER, roundedBox(w, h, d, 0.003, 0.0012));
  // The grille faces outward (+x, toward the ear side of the head).
  for (let i = 0; i < 5; i++) a.add(GRILLE, box(0.0006, h * 0.5, 0.0018), [w / 2, 0, (i - 2) * 0.004]);
  return a;
}

function facial(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  // A foam gasket: rounded outline with two eye openings and a cut for the nose.
  const outline = roundedRect(new Shape(), w, h, h * 0.4) as Shape;
  for (const s of [-1, 1]) {
    const eye = circleHole(h * 0.3, s * w * 0.21, h * 0.04);
    outline.holes.push(eye);
  }
  const a = new Assembly().add(FOAM, slab(outline, d * 0.85, d * 0.35, 20));
  a.add(TRIM, box(w * 0.12, h * 0.16, d * 0.6), [0, -h * 0.4, d * 0.1]);
  return a;
}

/** Builders by part id; every part of the headset spec has one. */
export const HEADSET_LOOKS: Record<string, LookBuilder> = {
  'part:shell': shell,
  'part:cameras': cameras,
  'part:board': board,
  'part:battery': battery,
  'part:display': display,
  'part:lens-left': lens,
  'part:lens-right': lens,
  'part:speakers': speakers,
  'part:facial': facial,
};
