import { BoxGeometry, Shape } from '@iwsdk/core';
import type { PartShape } from '@explode/contracts';
import { around, Assembly, circleHole, cyl, gearShape, lathe, ring, roundedBox, slab, type Finish } from './kit.ts';
import type { LookBuilder } from './look.ts';

/**
 * The EV drivetrain, part by part, as it looks on a bench: anodised pack, cast-aluminium
 * inverter and motor, machined steel gears, rubber boots and tyres on alloy rims. Every part
 * keeps the size its spec gives (the layout and ray targets depend on it). Rotational parts are
 * built about +y, as the spec's cylinder and gear shapes are, and then turned by its rotation.
 */
const ANODISED: Finish = { name: 'anodised', color: 0x30353c, metalness: 0.75, roughness: 0.42 };
const LID: Finish = { name: 'lid', color: 0x474e57, metalness: 0.7, roughness: 0.35 };
const CAST: Finish = { name: 'cast-aluminium', color: 0xaeb3b8, metalness: 0.9, roughness: 0.48 };
const PAINT: Finish = { name: 'paint', color: 0x22262c, metalness: 0.2, roughness: 0.55, clearcoat: 0.4 };
const STEEL: Finish = { name: 'steel', color: 0xd4d8dc, metalness: 1, roughness: 0.22 };
const DARK_STEEL: Finish = { name: 'dark-steel', color: 0x7d838a, metalness: 1, roughness: 0.32 };
const IRON: Finish = { name: 'cast-iron', color: 0x585e66, metalness: 0.85, roughness: 0.55 };
const COPPER: Finish = { name: 'copper', color: 0xc8783f, metalness: 1, roughness: 0.3 };
const HV_ORANGE: Finish = { name: 'hv-orange', color: 0xff6a12, metalness: 0, roughness: 0.4, clearcoat: 0.3 };
const BLACK_PLASTIC: Finish = { name: 'black-plastic', color: 0x16181b, metalness: 0, roughness: 0.6 };
const RUBBER: Finish = { name: 'rubber', color: 0x1b1c1f, metalness: 0, roughness: 0.88 };
const ALLOY: Finish = { name: 'alloy', color: 0xc9cdd2, metalness: 1, roughness: 0.18, clearcoat: 0.6 };
const COOLANT: Finish = { name: 'coolant-line', color: 0x2f6f9a, metalness: 0.1, roughness: 0.4, clearcoat: 0.5 };

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const HALF = Math.PI / 2;

function battery(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const a = new Assembly()
    .add(ANODISED, roundedBox(w, d, h * 0.72, 0.008, 0.0015).rotateX(HALF), [0, -h * 0.12, 0])
    .add(LID, roundedBox(w * 0.95, d * 0.92, h * 0.18, 0.006, 0.0008).rotateX(HALF), [0, h * 0.33, 0]);
  // Stiffening ribs across the lid, and the coolant line along the front edge.
  for (const z of [-0.36, -0.12, 0.12, 0.36]) a.add(LID, box(w * 0.9, h * 0.12, 0.004), [0, h * 0.46, z * d]);
  a.add(COOLANT, cyl(0.0025, w * 0.86, 12), [0, -h * 0.15, d / 2 + 0.001], [0, 0, HALF]);
  // Mounting flanges at the corners.
  for (const x of [-1, 1]) for (const z of [-0.3, 0.3]) a.add(DARK_STEEL, box(0.012, 0.003, 0.016), [x * (w / 2 + 0.004), -h * 0.36, z * d]);
  // The high-voltage connector, orange as every HV part is.
  a.add(HV_ORANGE, roundedBox(0.026, 0.012, 0.012, 0.003), [0.05, h * 0.05, d / 2 + 0.004]);
  a.add(HV_ORANGE, cyl(0.0035, 0.008, 14), [0.044, h * 0.05, d / 2 + 0.011], [HALF, 0, 0]);
  a.add(HV_ORANGE, cyl(0.0035, 0.008, 14), [0.056, h * 0.05, d / 2 + 0.011], [HALF, 0, 0]);
  return a;
}

function inverter(p: PartShape): Assembly {
  const [w, h, d] = p.size;
  const a = new Assembly().add(CAST, roundedBox(w, d, h * 0.62, 0.005, 0.0012).rotateX(HALF), [0, -h * 0.19, 0]);
  // Heatsink fins along the top.
  const fins = 9;
  for (let i = 0; i < fins; i++) a.add(CAST, box(0.0014, h * 0.36, d * 0.9), [(i / (fins - 1) - 0.5) * w * 0.86, h * 0.31, 0]);
  // HV in (from the pack) and the three phase leads out (to the motor).
  a.add(HV_ORANGE, roundedBox(0.016, 0.009, 0.008, 0.002), [-0.016, -h * 0.2, d / 2 + 0.003]);
  for (const x of [0.006, 0.014, 0.022]) a.add(HV_ORANGE, cyl(0.0028, 0.007, 12), [x, -h * 0.2, d / 2 + 0.003], [HALF, 0, 0]);
  a.add(BLACK_PLASTIC, roundedBox(0.012, 0.006, 0.006, 0.0015), [-0.018, -h * 0.2, -d / 2 - 0.002]);
  return a;
}

function motor(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const len = p.size[1];
  const a = new Assembly().add(CAST, cyl(r * 0.86, len * 0.8, 40));
  // Cooling fins round the housing.
  const fins = 11;
  for (let i = 0; i < fins; i++) a.add(CAST, ring(r * 0.85, r * 0.98, 0.0022, 40), [0, (i / (fins - 1) - 0.5) * len * 0.66, 0]);
  a.add(COPPER, ring(r * 0.84, r * 0.9, 0.004, 40), [0, len * 0.37, 0]);
  // Painted end caps, the steel shaft out of the drive end, and the cap bolts (they show it turning).
  const cap: Array<[number, number]> = [[0, 0], [r * 0.9, 0], [r * 0.9, 0.004], [r * 0.7, 0.008], [r * 0.25, 0.009], [0, 0.009]];
  a.add(PAINT, lathe(cap, 40), [0, len * 0.4, 0]);
  a.add(PAINT, lathe(cap, 40), [0, -len * 0.4, 0], [Math.PI, 0, 0]);
  a.add(STEEL, cyl(r * 0.14, len * 0.16, 16), [0, len * 0.54, 0]);
  for (const g of around(6, r * 0.62, len * 0.4 + 0.0065, () => cyl(0.0018, 0.003, 6))) a.add(DARK_STEEL, g);
  for (const g of around(6, r * 0.62, -len * 0.4 - 0.0065, () => cyl(0.0018, 0.003, 6))) a.add(DARK_STEEL, g);
  return a;
}

function gearbox(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const t = p.size[1];
  // A compound reduction gear: the large wheel and its pinion on one hub.
  return new Assembly()
    .add(STEEL, slab(gearShape(28, r * 0.88, r, r * 0.22, 5, r * 0.15, r * 0.55), t * 0.55, 0.0006).rotateX(-HALF), [0, -t * 0.12, 0])
    .add(DARK_STEEL, slab(gearShape(13, r * 0.4, r * 0.48, r * 0.12), t * 0.4, 0.0005).rotateX(-HALF), [0, t * 0.3, 0])
    .add(DARK_STEEL, ring(r * 0.14, r * 0.26, t, 24))
    .add(STEEL, cyl(r * 0.14, t * 1.25, 16));
}

function differential(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const t = p.size[1];
  const carrier: Array<[number, number]> = [
    [r * 0.22, -t / 2], [r * 0.34, -t / 2], [r * 0.42, -t * 0.32], [r * 0.66, -t * 0.12], [r * 0.7, t * 0.04],
    [r * 0.62, t * 0.2], [r * 0.38, t * 0.38], [r * 0.3, t / 2], [r * 0.22, t / 2],
  ];
  const a = new Assembly()
    .add(STEEL, slab(gearShape(34, r * 0.9, r, r * 0.6), t * 0.24, 0.0005).rotateX(-HALF), [0, t * 0.08, 0])
    .add(IRON, lathe(carrier, 36))
    .add(STEEL, cyl(r * 0.2, t * 1.1, 16));
  for (const g of around(8, r * 0.75, t * 0.21, () => cyl(0.0016, 0.003, 6))) a.add(DARK_STEEL, g);
  return a;
}

function axle(p: PartShape): Assembly {
  const r = p.size[0] / 2;
  const len = p.size[1];
  // A steel shaft with a CV joint at each end under a rubber bellows boot.
  const boot: Array<[number, number]> = [];
  const folds = 5;
  for (let i = 0; i <= folds * 2; i++) boot.push([r * (i % 2 ? 0.9 : 0.62) * (1 + 0.5 * (i / (folds * 2))), (i / (folds * 2)) * len * 0.28]);
  const a = new Assembly().add(STEEL, cyl(r * 0.36, len * 0.98, 14));
  a.add(RUBBER, lathe(boot, 20), [0, len * 0.14, 0]);
  a.add(RUBBER, lathe(boot, 20), [0, -len * 0.14, 0], [Math.PI, 0, 0]);
  a.add(DARK_STEEL, cyl(r * 0.95, len * 0.08, 18), [0, len * 0.46, 0]);
  a.add(DARK_STEEL, cyl(r * 0.95, len * 0.08, 18), [0, -len * 0.46, 0]);
  return a;
}

function wheel(p: PartShape, id: string): Assembly {
  const rOut = p.size[0] / 2;
  const half = p.size[1] / 2;
  const side = id.endsWith('left') ? -1 : 1; // the spoked face looks outward, away from the car
  const k = rOut / 0.035;
  // Tyre cross-section, outer surface first, with two tread grooves.
  const tyre: Array<[number, number]> = (
    [
      [0.0235, -0.82], [0.027, -0.98], [0.031, -1], [0.0338, -0.89], [0.035, -0.68], [0.035, -0.47], [0.0336, -0.44], [0.0336, -0.29],
      [0.035, -0.25], [0.035, 0.25], [0.0336, 0.29], [0.0336, 0.44], [0.035, 0.47], [0.035, 0.68], [0.0338, 0.89], [0.031, 1],
      [0.027, 0.98], [0.0235, 0.82], [0.0235, -0.82],
    ] as Array<[number, number]>
  ).map(([r, y]) => [r * k, y * half]);
  const face = new Shape();
  face.absarc(0, 0, rOut * 0.64, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2;
    face.holes.push(circleHole(rOut * 0.16, rOut * 0.4 * Math.cos(t), rOut * 0.4 * Math.sin(t)));
  }
  face.holes.push(circleHole(rOut * 0.09, 0, 0));
  const a = new Assembly()
    .add(RUBBER, lathe(tyre, 48), [0, 0, 0], [HALF, 0, 0])
    .add(ALLOY, ring(rOut * 0.62, rOut * 0.68, half * 1.7, 48), [0, 0, 0], [HALF, 0, 0])
    .add(ALLOY, slab(face, half * 0.3, 0.0006, 24), [0, 0, side * half * 0.55])
    .add(ALLOY, cyl(rOut * 0.1, half * 0.5, 20), [0, 0, side * half * 0.6], [HALF, 0, 0])
    .add(DARK_STEEL, cyl(rOut * 0.5, 0.0016, 36), [0, 0, -side * half * 0.2], [HALF, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + Math.PI / 5;
    a.add(STEEL, cyl(0.0014, 0.002, 6), [rOut * 0.2 * Math.cos(t), rOut * 0.2 * Math.sin(t), side * half * 0.75], [HALF, 0, 0]);
  }
  return a;
}

/** Builders by part id; every part of the drivetrain spec has one. */
export const DRIVETRAIN_LOOKS: Record<string, LookBuilder> = {
  'part:battery': battery,
  'part:inverter': inverter,
  'part:motor': motor,
  'part:gearbox': gearbox,
  'part:differential': differential,
  'part:axle-left': axle,
  'part:axle-right': axle,
  'part:wheel-left': wheel,
  'part:wheel-right': wheel,
};
