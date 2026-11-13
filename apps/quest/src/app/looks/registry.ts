import type { PartShape } from '@explode/contracts';
import type { Texture } from '@iwsdk/core';
import { partGeometry } from '../shapes.ts';
import { DRIVETRAIN_LOOKS } from './drivetrain.ts';
import { HEADSET_LOOKS } from './headset.ts';
import { Assembly, type Finish } from './kit.ts';
import { PartLook, type LookBuilder } from './look.ts';

/** Lifelike builders by system; a part without one is drawn as its spec shape in satin plastic. */
const LOOKS: Record<string, Record<string, LookBuilder>> = {
  'system:ev-drivetrain': DRIVETRAIN_LOOKS,
  'system:mr-headset': HEADSET_LOOKS,
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
  return new PartLook(assembly, env);
}

/** True when a part has a dedicated lifelike model (tests). */
export function hasLook(systemId: string, partId: string): boolean {
  return !!LOOKS[systemId]?.[partId];
}
