import type { Motion } from './look.ts';

/**
 * Motion shared by the lifelike models: the order a model comes apart in, and the small movement
 * of a part held in the air. Everything here is zero when the model is closed, so a closed model
 * is exactly its layout, and nothing allocates.
 */

/** How far a part tips in mid-flight (radians), and how far it rides up and down once out (metres). */
const TIP = 0.32;
const BOB = 0.0016;

/**
 * A part in the air: it tips about `axis` as it flies and is level again when it arrives, then
 * rides gently up and down. `phase` keeps neighbours out of step; `tip` scales (or reverses) the tip.
 * Not for a part that spins on its own axis: its model turns with it.
 */
export function afloat(phase: number, axis: 'x' | 'z' = 'z', tip = 1): Motion {
  return (group, time, open) => {
    group.rotation[axis] = TIP * tip * Math.sin(Math.PI * open);
    group.position.y = BOB * Math.sin(time * 1.1 + phase) * open;
  };
}

/**
 * The headset comes apart the way it would be taken apart: the visor and the facial interface
 * come off, then what is mounted behind them, then the optics at the middle.
 */
export const HEADSET_STAGES: Record<string, number> = {
  'part:shell': 0,
  'part:facial': 0.1,
  'part:speakers': 0.25,
  'part:cameras': 0.4,
  'part:board': 0.55,
  'part:battery': 0.65,
  'part:display': 0.8,
  'part:lens-left': 1,
  'part:lens-right': 1,
};

export const HEADSET_MOTION: Record<string, Motion> = {
  'part:shell': afloat(0, 'x', -0.6),
  'part:facial': afloat(0.9, 'x', 0.6),
  'part:speakers': afloat(1.8),
  'part:cameras': afloat(2.7, 'z', -1),
  'part:board': afloat(3.6),
  'part:battery': afloat(4.5, 'z', -1),
  'part:display': afloat(5.4),
  // Lenses stay square to the eye: they only ride.
  'part:lens-left': afloat(0.4, 'z', 0),
  'part:lens-right': afloat(3.5, 'z', 0),
};

/**
 * The drivetrain comes apart from the road inward: wheels, axles, differential, gearbox, motor,
 * inverter, and the battery pack last. Its shafts and wheels already turn while power reaches them.
 */
export const DRIVETRAIN_STAGES: Record<string, number> = {
  'part:wheel-left': 0,
  'part:wheel-right': 0,
  'part:axle-left': 0.2,
  'part:axle-right': 0.2,
  'part:differential': 0.4,
  'part:gearbox': 0.55,
  'part:motor': 0.7,
  'part:inverter': 0.85,
  'part:battery': 1,
};

export const DRIVETRAIN_MOTION: Record<string, Motion> = {
  'part:inverter': afloat(1.2),
  'part:battery': afloat(0, 'x', 0.5),
};
