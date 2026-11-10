import { z } from 'zod';

/** Stable, deterministic identifier: lowercase segments joined by `.`, `:`, `/`, `_` or `-`. */
export const Id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:/#@>-]*$/, 'ids are lowercase, deterministic, and contain no spaces');
export type Id = z.infer<typeof Id>;

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
