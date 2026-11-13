import type { PartShape } from '@explode/contracts';
import type { Texture } from '@iwsdk/core';
import { partGeometry } from '../shapes.ts';
import { DRIVETRAIN_LOOKS } from './drivetrain.ts';
import { HEADSET_LOOKS } from './headset.ts';
import { JUPITER_LOOKS, JUPITER_MOTION, JUPITER_STAGES, driftClouds } from './jupiter.ts';
import { Assembly, type Finish } from './kit.ts';
import { PartLook, type LookBuilder, type Motion } from './look.ts';
import { DRIVETRAIN_MOTION, DRIVETRAIN_STAGES, HEADSET_MOTION, HEADSET_STAGES } from './motion.ts';

/** Lifelike builders by system; a part without one is drawn as its spec shape in satin plastic. */
const LOOKS: Record<string, Record<string, LookBuilder>> = {
  'system:ev-drivetrain': DRIVETRAIN_LOOKS,
  'system:mr-headset': HEADSET_LOOKS,
  'system:jupiter': JUPITER_LOOKS,
};

/** The order parts leave in as a model opens, and what moves by itself, by system. A model without an entry opens all at once and holds still. */
const STAGES: Record<string, Record<string, number>> = {
  'system:ev-drivetrain': DRIVETRAIN_STAGES,
  'system:mr-headset': HEADSET_STAGES,
  'system:jupiter': JUPITER_STAGES,
};
const MOTION: Record<string, Record<string, Motion>> = {
  'system:ev-drivetrain': DRIVETRAIN_MOTION,
  'system:mr-headset': HEADSET_MOTION,
  'system:jupiter': JUPITER_MOTION,
};

const finishes = new Map<string, Finish>();

function satin(color: string): Finish {
  let f = finishes.get(color);
  if (!f) {
    f = { name: `satin-${color}`, color: parseInt(color.slice(1), 16), metalness: 0.15, roughness: 0.45, clearcoat: 0.3 };
    finishes.set(color, f);
  }
  return f;
}

/** The lifelike look of one mechanical part, in its own frame (the hit volume's), rotation applied. */
export function buildLook(systemId: string, partId: string, part: PartShape, env: Texture | null): PartLook {
  const builder = LOOKS[systemId]?.[partId];
  const assembly = builder ? builder(part, partId).rotate(part.rotation_deg) : new Assembly().add(satin(part.color), partGeometry(part));
  const look = new PartLook(assembly, env);
  look.stage = STAGES[systemId]?.[partId] ?? null;
  look.move = MOTION[systemId]?.[partId] ?? null;
  return look;
}

/** True when a part has a dedicated lifelike model (tests). */
export function hasLook(systemId: string, partId: string): boolean {
  return !!LOOKS[systemId]?.[partId];
}

/** Move what moves by itself in the looks (Jupiter's winds) to `time` seconds. Once a frame; no allocation. */
export function tickLooks(time: number): void {
  driftClouds(time);
}
