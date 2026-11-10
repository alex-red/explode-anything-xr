import type { ContentBundle } from '@explode/contracts';
import { ContentBundle as ContentBundleSchema, canonicalJson, checkBundleIntegrity } from '@explode/contracts';
import { sha256 } from '@explode/indexer';
import { layoutProblems } from './layout.ts';

export type BundleDraft = Omit<ContentBundle, 'content_hash' | 'generated_at' | 'bundle_version' | 'generator'>;

export const GENERATOR = 'explode-content-tools@0.1.0';

export function contentHash(bundle: Omit<ContentBundle, 'content_hash' | 'generated_at'> | ContentBundle): string {
  const { content_hash: _h, generated_at: _g, ...rest } = bundle as ContentBundle;
  return sha256(canonicalJson(rest));
}

/**
 * Validate, hash, and stamp a bundle. Throws on schema, integrity, or layout problems.
 * `previous` keeps `generated_at` when nothing changed, so regenerating is byte-stable.
 */
export function finalizeBundle(draft: BundleDraft, previous?: ContentBundle | null): ContentBundle {
  const provisional = ContentBundleSchema.parse({
    bundle_version: '1',
    generator: GENERATOR,
    ...draft,
    content_hash: '0'.repeat(64),
    generated_at: '1970-01-01T00:00:00.000Z',
  });
  const hash = contentHash(provisional);
  const generated_at = previous && previous.content_hash === hash ? previous.generated_at : new Date().toISOString();
  const bundle = { ...provisional, content_hash: hash, generated_at };
  const problems = [...checkBundleIntegrity(bundle), ...layoutProblems(bundle.layout)];
  if (problems.length) throw new Error(`bundle ${bundle.graph.system_id} has problems:\n- ${problems.join('\n- ')}`);
  return bundle;
}

/** Re-validate a bundle read from disk. Returns problems; empty means valid and hash matches. */
export function verifyBundle(raw: unknown): string[] {
  const parsed = ContentBundleSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const b = parsed.data;
  const problems = [...checkBundleIntegrity(b), ...layoutProblems(b.layout)];
  const hash = contentHash(b);
  if (hash !== b.content_hash) problems.push(`content_hash mismatch: stored ${b.content_hash}, computed ${hash}`);
  return problems;
}
