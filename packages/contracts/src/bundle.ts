import { z } from 'zod';
import { Sha256 } from './common.ts';
import { Evidence } from './evidence.ts';
import { SystemGraph } from './graph.ts';
import { AssetManifest, Layout } from './layout.ts';
import { Lesson } from './lesson.ts';

/** Everything the client needs for one system, bundled at build time and precached offline. */
export const ContentBundle = z.object({
  bundle_version: z.literal('1'),
  graph: SystemGraph,
  evidence: z.array(Evidence),
  layout: Layout,
  lessons: z.array(Lesson),
  assets: AssetManifest.nullable(),
  /** sha256 of canonicalJson(bundle without content_hash and generated_at). */
  content_hash: Sha256,
  generated_at: z.string(),
  generator: z.string(),
});
export type ContentBundle = z.infer<typeof ContentBundle>;
