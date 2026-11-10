import { z } from 'zod';
import { HexColor, Id, Vec3 } from './common.ts';

/** Positions are meters relative to the system anchor, +x right, +y up, -z away from the viewer. */
export const NodePlacement = z.object({
  collapsed: Vec3,
  exploded: Vec3,
  radius: z.number().positive(),
});
export type NodePlacement = z.infer<typeof NodePlacement>;

export const Layout = z.object({
  system_id: Id,
  /** Anchor distance from the seated viewer, meters. */
  anchor_distance: z.number().positive(),
  /** Angular budget the exploded layout must fit inside (Glasses-safe). */
  cone_deg: z.object({ horizontal: z.number().positive(), vertical: z.number().positive() }),
  placements: z.record(Id, NodePlacement),
});
export type Layout = z.infer<typeof Layout>;

/** Procedural geometry for authored mechanical parts (no third-party meshes, see ADR-0019). */
export const PartShape = z.object({
  shape: z.enum(['box', 'cylinder', 'sphere', 'torus', 'gear']),
  size: Vec3,
  color: HexColor,
  rotation_deg: Vec3.default([0, 0, 0]),
  /** Spins while its flow is live, e.g. motor shaft and wheels. */
  spin_axis: z.enum(['x', 'y', 'z']).optional(),
});
export type PartShape = z.infer<typeof PartShape>;

export const AssetManifest = z.object({
  parts: z.record(Id, PartShape),
});
export type AssetManifest = z.infer<typeof AssetManifest>;
