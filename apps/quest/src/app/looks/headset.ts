import { BoxGeometry } from '@iwsdk/core';
import type { PartShape } from '@explode/contracts';
import { Assembly, circleHole, cyl, lathe, loft, polygon, ring, roundedBox, slab, type Finish, type Section } from './kit.ts';
import type { LookBuilder } from './look.ts';

/**
 * The mixed-reality headset, drawn as hardware: a hollow white visor that wraps round the face,
 * two clusters of three sensor windows over their camera modules, a notched board with its
 * shielded processor, heat pipe and blower fan, a foil pouch battery, one LCD panel with its
 * flex cable, Fresnel lenses in light shrouds, strap-arm speakers, and a foam facial interface
 * arched over the nose. Front is +z (toward the viewer), as in the spec; the eyes are at -z, so
 * the wearer's left is +x.
 *
 * Still the teaching model the spec describes: parts, proportions and positions are illustrative,
 * not the device's real internals, and nothing here carries a logo or a wordmark.
 */
const SHELL: Finish = { name: 'visor-plastic', color: 0xf0f1f2, metalness: 0, roughness: 0.42, clearcoat: 0.3 };
const TRIM: Finish = { name: 'trim', color: 0x8b9097, metalness: 0.1, roughness: 0.5 };
const BODY: Finish = { name: 'body-plastic', color: 0x2e3136, metalness: 0, roughness: 0.6 };
const GLOSS_BLACK: Finish = { name: 'gloss-black', color: 0x0a0b0d, metalness: 0.1, roughness: 0.12, clearcoat: 1 };
const SENSOR_GLASS: Finish = { name: 'sensor-glass', color: 0x1a2b45, metalness: 0.3, roughness: 0.05, clearcoat: 1, envIntensity: 1.6 };
const BRIGHT_RING: Finish = { name: 'lens-ring', color: 0xb9bec4, metalness: 1, roughness: 0.25 };
const PCB: Finish = { name: 'pcb', color: 0x17523a, metalness: 0.05, roughness: 0.42, clearcoat: 0.6 };
const CHIP: Finish = { name: 'chip', color: 0x141619, metalness: 0.2, roughness: 0.4 };
const LID: Finish = { name: 'shield-can', color: 0xc0c5ca, metalness: 1, roughness: 0.32 };
const COPPER: Finish = { name: 'copper', color: 0xc77b4a, metalness: 1, roughness: 0.3 };
const GOLD: Finish = { name: 'gold', color: 0xd9ab48, metalness: 1, roughness: 0.25 };
const PASSIVES: Finish = { name: 'passives', color: 0x9c8a6c, metalness: 0.2, roughness: 0.5 };
const FOIL: Finish = { name: 'pouch-foil', color: 0xc8ccd2, metalness: 0.9, roughness: 0.34 };
const LABEL: Finish = { name: 'label', color: 0x1b1d21, metalness: 0, roughness: 0.6 };
const KAPTON: Finish = { name: 'kapton', color: 0xc8922e, metalness: 0.3, roughness: 0.3, clearcoat: 0.6 };
const NICKEL: Finish = { name: 'nickel', color: 0xa9adb2, metalness: 1, roughness: 0.38 };
const FRAME: Finish = { name: 'display-frame', color: 0x1c1d20, metalness: 0.5, roughness: 0.45 };
const SCREEN: Finish = { name: 'screen', color: 0x05070a, metalness: 0.2, roughness: 0.08, clearcoat: 1, emissive: 0x3d78c4, emissiveIntensity: 0.6 };
const FLEX: Finish = { name: 'flex-cable', color: 0xc47f2c, metalness: 0.3, roughness: 0.38 };
const LENS_GLASS: Finish = { name: 'lens-glass', color: 0xe3edf4, metalness: 0, roughness: 0.05, clearcoat: 1, opacity: 0.36, envIntensity: 1.8 };
const BARREL: Finish = { name: 'lens-shroud', color: 0x121316, metalness: 0, roughness: 0.6 };
const SPEAKER: Finish = { name: 'speaker', color: 0x1a1b1e, metalness: 0, roughness: 0.65 };
const GRILLE: Finish = { name: 'grille', color: 0x4a4f57, metalness: 0.8, roughness: 0.4 };
const FOAM: Finish = { name: 'foam-fabric', color: 0x26282c, metalness: 0, roughness: 1, sheen: 1 };

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const HALF = Math.PI / 2;

/** How strongly the visor wraps round the face: a point at x sits `BOW · x²` further back. */
const BOW = 0.9;
/** Outline power of the visor and the facial interface: a soft rounded rectangle. */
const N = 3.4;
/**
 * Where the visor's front face sits in the cameras' own frame. The two parts are separate, so
 * this restates the spec: shell centre z 0.028 with its face 0.032 ahead, cameras at z 0.054.
 */
const FACE_FROM_CAMERAS = 0.028 + 0.032 - 0.054;

/** Run out along `outer`, back along a skin `t` inside it, and close the lip: a hollow shell. */
function hollow(outer: readonly Section[], t: number): Section[] {
  const inner = outer
    .map((s, i) => ({ ...s, hw: Math.max(1e-4, s.hw - t), hh: Math.max(1e-4, s.hh - t), z: i === 0 ? s.z : s.z - t }))
    .reverse();
  return [...outer, ...inner, outer[0]!];
}

function shell(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const hw = w / 2;
  const hh = h / 2;
  const zb = -d / 2;
  const zf = d / 2 + 0.001;
  // Side walls, a rolled edge, then a face that keeps the wrap all the way to its centre.
  const outer: Section[] = [
    { z: zb, hw, hh, n: N, bow: BOW, nose: 0.012 },
    { z: zb + 0.022, hw, hh, n: N, bow: BOW, nose: 0.009 },
    { z: zf - 0.012, hw, hh, n: N, bow: BOW, nose: 0.004 },
    { z: zf - 0.005, hw: hw - 0.0015, hh: hh - 0.0015, n: N, bow: BOW },
    { z: zf - 0.0015, hw: hw - 0.005, hh: hh - 0.005, n: N, bow: BOW },
    { z: zf, hw: hw - 0.011, hh: hh - 0.011, n: N, bow: BOW },
  ];
  for (const f of [0.8, 0.6, 0.4, 0.2, 0.001]) outer.push({ z: zf, hw: (hw - 0.011) * f, hh: (hh - 0.011) * f, n: N, bow: BOW });
  const a = new Assembly().add(SHELL, loft(hollow(outer, 0.0018), 56));
  // The seam where the faceplate meets the body.
  a.add(TRIM, loft([{ z: zf - 0.0126, hw: hw + 0.0003, hh: hh + 0.0003, n: N, bow: BOW, nose: 0.004 }, { z: zf - 0.0114, hw: hw + 0.0003, hh: hh + 0.0003, n: N, bow: BOW, nose: 0.004 }], 56));
  // A button on top, a volume rocker underneath, and the stubs the strap arms hang from.
  a.add(TRIM, roundedBox(0.014, 0.005, 0.0016, 0.0025, 0.0004), [-0.03, hh, zf - 0.03], [HALF, 0, 0]);
  a.add(TRIM, roundedBox(0.022, 0.0045, 0.0016, 0.0022, 0.0004), [0.05, -hh * 0.965, zf - 0.034], [HALF, 0, 0]);
  for (const s of [-1, 1]) a.add(TRIM, roundedBox(0.006, 0.024, 0.02, 0.0028), [s * (hw + 0.0025), 0.02, zb + 0.011 - BOW * hw * hw]);
  return a;
}

function cameras(p: PartShape): Assembly {
  const [w] = p.size;
  const a = new Assembly();
  // On each side three windows in a triangle: a colour camera, a tracking camera and an
  // infrared lamp. Each window lies on the visor's curved face; its module sits behind it.
  const windows: ReadonlyArray<readonly [number, number, number]> = [
    [-0.0088, -0.0062, 1],
    [0.0088, -0.0062, 0.86],
    [0, 0.0088, 0.62],
  ];
  for (const s of [-1, 1]) {
    for (const [dx, dy, k] of windows) {
      const x = s * (w * 0.36 + dx);
      const z = FACE_FROM_CAMERAS - BOW * x * x;
      const lean = -Math.atan(2 * BOW * x); // tilt each window to the face it sits on
      a.add(GLOSS_BLACK, cyl(0.0062 * k, 0.0012, 28), [x, dy, z + 0.0002], [HALF, 0, lean]);
      a.add(BRIGHT_RING, ring(0.004 * k, 0.005 * k, 0.0016, 28), [x, dy, z + 0.0004], [HALF, 0, lean]);
      a.add(SENSOR_GLASS, lathe([[0, 0], [0.004 * k, 0], [0.0034 * k, 0.001], [0, 0.0014]], 24), [x, dy, z + 0.0008], [HALF, 0, lean]);
      a.add(GLOSS_BLACK, cyl(0.0036 * k, 0.003, 20), [x, dy, z - 0.002], [HALF, 0, 0]);
      a.add(NICKEL, roundedBox(0.0088 * k, 0.0088 * k, 0.0045, 0.001, 0.0003), [x, dy, z - 0.0056]);
    }
  }
  // One flex cable joins the modules and drops to its connector.
  const zFlex = FACE_FROM_CAMERAS - BOW * (w * 0.36) ** 2 - 0.0082;
  a.add(FLEX, box(w * 0.86, 0.0065, 0.0004), [0, -0.0062, zFlex]);
  for (const s of [-1, 1]) a.add(FLEX, box(0.0065, 0.018, 0.0004), [s * w * 0.36, 0.002, zFlex]);
  a.add(FLEX, box(0.011, 0.01, 0.0004), [0, -0.0125, zFlex]);
  a.add(NICKEL, box(0.01, 0.0028, 0.0012), [0, -0.016, zFlex - 0.0006]);
  return a;
}

function board(p: PartShape): Assembly {
  const [w, h] = p.size;
  const x1 = w / 2;
  const y1 = h / 2;
  const c = 0.004;
  // Clipped corners, and a notch at the bottom where the nose goes.
  const outline = polygon([
    [-x1 + c, -y1], [-0.021, -y1], [-0.014, -y1 + 0.012], [0.014, -y1 + 0.012], [0.021, -y1], [x1 - c, -y1],
    [x1, -y1 + c], [x1, y1 - 2 * c], [x1 - 2 * c, y1], [-x1 + 2 * c, y1], [-x1, y1 - 2 * c], [-x1, -y1 + c],
  ]);
  for (const [hx, hy] of [[-0.9, 0.62], [0.9, 0.62], [-0.9, -0.7], [0.9, -0.7]] as const) outline.holes.push(circleHole(0.0016, x1 * hx, y1 * hy));
  const zp = -0.003;
  const top = zp + 0.0006;
  const a = new Assembly().add(PCB, slab(outline, 0.0012, 0.0002, 4), [0, 0, zp]);

  // The processor and its memory under a shield can, a copper plate on top, a heat pipe to the fan.
  a.add(LID, roundedBox(0.036, 0.03, 0.0022, 0.0015, 0.0003), [-0.02, 0.004, top + 0.0011]);
  a.add(COPPER, roundedBox(0.03, 0.023, 0.0007, 0.002, 0.0002), [-0.02, 0.004, top + 0.0025]);
  a.add(COPPER, roundedBox(0.058, 0.005, 0.0018, 0.0024, 0.0006), [0.008, 0.008, top + 0.0034]);
  const fx = 0.037;
  const fy = 0.006;
  a.add(CHIP, ring(0.0128, 0.0146, 0.005, 36), [fx, fy, top + 0.0025], [HALF, 0, 0]);
  a.add(CHIP, cyl(0.0146, 0.0006, 36), [fx, fy, top + 0.0003], [HALF, 0, 0]);
  a.add(CHIP, box(0.012, 0.012, 0.005), [fx + 0.0086, fy + 0.012, top + 0.0025]);
  a.add(CHIP, cyl(0.0044, 0.0044, 20), [fx, fy, top + 0.0024], [HALF, 0, 0]);
  a.add(LID, cyl(0.003, 0.0003, 20), [fx, fy, top + 0.0048], [HALF, 0, 0]);
  for (let i = 0; i < 11; i++) {
    const t = (i / 11) * Math.PI * 2;
    a.add(PASSIVES, box(0.0078, 0.0005, 0.0034), [fx + Math.cos(t) * 0.0084, fy + Math.sin(t) * 0.0084, top + 0.0024], [0, 0, t + 0.6]);
  }

  // Radio module under its own can, storage, power management.
  a.add(LID, roundedBox(0.015, 0.012, 0.0018, 0.001, 0.0003), [-0.052, 0.017, top + 0.0009]);
  a.add(CHIP, roundedBox(0.012, 0.014, 0.0012, 0.0006, 0.0002), [-0.052, -0.004, top + 0.0006]);
  a.add(CHIP, roundedBox(0.008, 0.008, 0.001, 0.0005, 0.0002), [0.006, -0.008, top + 0.0005]);
  a.add(CHIP, roundedBox(0.006, 0.006, 0.001, 0.0005, 0.0002), [0.052, -0.018, top + 0.0005]);
  // Board-to-board sockets for the cameras (top), the display and the battery (bottom), and a port.
  for (const [cx, cy] of [[-0.012, 0.0245], [0.02, 0.0245], [0.036, -0.0235], [-0.036, -0.0235]] as const) {
    a.add(CHIP, box(0.013, 0.0034, 0.0011), [cx, cy, top + 0.00055]);
    a.add(GOLD, box(0.011, 0.0016, 0.0013), [cx, cy, top + 0.00065]);
  }
  a.add(LID, roundedBox(0.0075, 0.0092, 0.0032, 0.0012, 0.0004), [-x1 + 0.0036, -0.012, top + 0.0016]);
  // Rows of passives beside the parts they serve.
  const rows = (x0: number, y0: number, nx: number, ny: number, dx: number, dy: number) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) a.add(PASSIVES, box(0.0014, 0.0008, 0.0007), [x0 + i * dx, y0 + j * dy, top + 0.00035]);
  };
  rows(-0.036, -0.0165, 9, 2, 0.0036, 0.0022);
  rows(-0.044, 0.0245, 6, 1, 0.0034, 0);
  rows(0.016, -0.014, 2, 4, 0.0026, 0.0024);
  rows(0.048, -0.008, 3, 2, 0.003, 0.0024);
  // The back of the board carries a little too.
  a.add(CHIP, roundedBox(0.014, 0.012, 0.001, 0.0006, 0.0002), [0.024, 0.006, zp - 0.0011]);
  a.add(CHIP, roundedBox(0.009, 0.009, 0.001, 0.0006, 0.0002), [-0.03, 0.008, zp - 0.0011]);
  for (let i = 0; i < 8; i++) a.add(PASSIVES, box(0.0014, 0.0008, 0.0007), [-0.012 + i * 0.0034, -0.006, zp - 0.00095]);
  return a;
}

function battery(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const y0 = -0.002;
  // A pouch cell: a soft foil block with its sealed terrace along the top, a wrap, and a strip
  // of tape over the fold.
  const a = new Assembly().add(FOIL, roundedBox(w - 0.004, h - 0.006, d, 0.0025, d * 0.36), [0, y0, 0]);
  a.add(FOIL, box(w - 0.007, 0.0045, 0.0007), [0, h / 2 - 0.0045, 0]);
  for (const s of [-1, 1]) a.add(FOIL, box(0.0022, h - 0.008, 0.0007), [s * (w / 2 - 0.0011), y0, 0]);
  a.add(LABEL, roundedBox(w * 0.56, h - 0.0056, d + 0.0004, 0.0026, d * 0.36), [-w * 0.1, y0, 0]);
  a.add(KAPTON, roundedBox(0.011, h - 0.0052, d + 0.0008, 0.0026, d * 0.36), [w * 0.33, y0, 0]);
  // Protection board on the terrace, its tabs, and the lead to the board.
  a.add(PCB, box(0.034, 0.0042, 0.001), [-0.006, h / 2 - 0.0036, 0.0008]);
  for (const s of [-1, 1]) a.add(GOLD, box(0.0045, 0.0036, 0.0004), [-0.006 + s * 0.011, h / 2 - 0.0036, 0.0015]);
  for (const s of [-1, 1]) a.add(LABEL, cyl(0.0006, 0.016, 8), [0.019, h / 2 - 0.0036 + s * 0.0008, 0.0014], [0, 0, HALF]);
  a.add(GOLD, box(0.005, 0.0045, 0.002), [0.029, h / 2 - 0.0036, 0.0014]);
  return a;
}

function display(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  // One LCD panel: a stamped metal back toward the front of the headset, black glass toward the
  // eyes with the two lit images, one per eye.
  const a = new Assembly().add(NICKEL, roundedBox(w - 0.002, h - 0.002, d * 0.5, 0.004, 0.0006), [0, 0, d * 0.24]);
  a.add(NICKEL, roundedBox(w * 0.8, h * 0.62, 0.0006, 0.004, 0.0002), [0, 0.003, d * 0.5]);
  a.add(FRAME, roundedBox(w, h, d * 0.5, 0.0045, 0.0006), [0, 0, -d * 0.2]);
  a.add(GLOSS_BLACK, roundedBox(w - 0.003, h - 0.003, 0.0006, 0.0035, 0.0002), [0, 0, -d * 0.47]);
  for (const s of [-1, 1]) a.add(SCREEN, roundedBox(w * 0.43, h * 0.86, 0.0003, 0.014, 0.0001), [s * w * 0.235, 0, -d * 0.53]);
  // The flex cable leaves the bottom edge and folds up over the back to its connector.
  a.add(FLEX, box(0.046, 0.0075, 0.0004), [0.028, -h / 2 - 0.0026, d * 0.3]);
  a.add(FLEX, box(0.046, 0.0004, d * 0.36), [0.028, -h / 2 - 0.0062, d * 0.46]);
  a.add(FLEX, box(0.046, 0.026, 0.0004), [0.028, -h / 2 + 0.0066, d * 0.64]);
  a.add(FRAME, box(0.03, 0.0032, 0.0007), [0.028, -h / 2 + 0.006, d * 0.64 + 0.0005]);
  a.add(GOLD, box(0.013, 0.003, 0.0011), [0.028, -h / 2 + 0.0165, d * 0.64 + 0.0007]);
  return a;
}

function lens(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const R = r * 0.84;
  // A Fresnel lens, about +y (the display side once the part is turned): smooth and gently
  // domed toward the eye, concentric ridges toward the display.
  const glass: Array<[number, number]> = [[0, -0.0064], [R * 0.4, -0.006], [R * 0.75, -0.005], [R, -0.0036], [R, -0.0012]];
  const ridges = 16;
  for (let i = ridges; i >= 1; i--) glass.push([(R * i) / ridges, -0.0012], [(R * (i - 1)) / ridges + 0.0001, -0.0005]);
  glass.push([0, -0.0005]);
  // Its holder, and the cone that keeps stray light off the panel.
  const shroud: Array<[number, number]> = [[R, -0.0052], [R + 0.004, -0.0052], [R + 0.004, -0.001], [r * 1.12, 0.008], [r * 1.12 - 0.0012, 0.008], [R, -0.001], [R, -0.0052]];
  return new Assembly().add(LENS_GLASS, lathe(glass, 48)).add(BARREL, lathe(shroud, 48)).add(BARREL, ring(R * 0.97, R + 0.0034, 0.0008, 48), [0, -0.0056, 0]);
}

function speakers(p: PartShape): Assembly {
  const [w, , d] = p.size;
  const a = new Assembly();
  // One on each strap arm, firing inward and down toward the ear, with its lead running forward.
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.0035);
    a.add(SHELL, roundedBox(0.007, 0.024, d, 0.0034, 0.0008), [x, 0, 0]);
    a.add(SPEAKER, roundedBox(0.022, 0.013, 0.0036, 0.003, 0.0006), [x - s * 0.005, -0.002, -0.002], [0, HALF, 0]);
    for (let i = 0; i < 6; i++) a.add(GRILLE, box(0.0005, 0.008, 0.0012), [x - s * 0.007, -0.002, -0.002 + (i - 2.5) * 0.0028]);
    a.add(FLEX, box(0.0004, 0.005, d * 0.5), [x - s * 0.0038, 0.006, d * 0.3]);
  }
  return a;
}

function facial(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const hw = w / 2;
  const hh = h / 2;
  const zf = d / 2;
  // A hollow frame that meets the visor's back edge and flares toward the face, where the wrap
  // deepens and the lower edge arches over the nose. Sections run out along the outside and back
  // along the inside, so the wall has thickness.
  const frame: Section[] = [
    { z: zf, hw: hw - 0.004, hh: hh - 0.004, n: N, bow: BOW, nose: 0.012 },
    { z: 0, hw: hw - 0.002, hh: hh - 0.002, n: 3.2, bow: 1.2, nose: 0.016 },
    { z: -0.008, hw: hw - 0.001, hh: hh - 0.001, n: 3, bow: 1.5, nose: 0.018 },
    { z: -0.008, hw: hw - 0.007, hh: hh - 0.007, n: 3, bow: 1.5, nose: 0.018 },
    { z: 0, hw: hw - 0.008, hh: hh - 0.008, n: 3.2, bow: 1.2, nose: 0.016 },
    { z: zf, hw: hw - 0.0085, hh: hh - 0.0085, n: N, bow: BOW, nose: 0.012 },
  ];
  // The foam pad: fatter than the frame, rounded where it meets the face.
  const pad: Section[] = [
    { z: -0.008, hw: hw - 0.0005, hh: hh - 0.0005, n: 3, bow: 1.5, nose: 0.018 },
    { z: -0.015, hw: hw + 0.001, hh: hh + 0.001, n: 3, bow: 1.8, nose: 0.021 },
    { z: -0.021, hw: hw - 0.001, hh: hh - 0.001, n: 3, bow: 1.9, nose: 0.022 },
    { z: -0.023, hw: hw - 0.007, hh: hh - 0.007, n: 3, bow: 1.9, nose: 0.022 },
    { z: -0.021, hw: hw - 0.013, hh: hh - 0.013, n: 3, bow: 1.9, nose: 0.022 },
    { z: -0.014, hw: hw - 0.014, hh: hh - 0.014, n: 3, bow: 1.7, nose: 0.02 },
    { z: -0.008, hw: hw - 0.0075, hh: hh - 0.0075, n: 3, bow: 1.5, nose: 0.018 },
  ];
  return new Assembly().add(BODY, loft([...frame, frame[0]!], 56)).add(FOAM, loft([...pad, pad[0]!], 56));
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
