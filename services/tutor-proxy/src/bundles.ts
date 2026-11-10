import type { ContentBundle } from '@explode/contracts';
import { ContentBundle as ContentBundleSchema } from '@explode/contracts';
import { createContext, type EngineContext } from '@explode/lesson-engine';

/** Lookup from system_id to its bundle and engine context. Injectable so tests use fixtures. */
export interface BundleRegistry {
  get(systemId: string): { bundle: ContentBundle; ctx: EngineContext } | undefined;
}

export function createRegistry(bundles: readonly unknown[]): BundleRegistry {
  const map = new Map<string, { bundle: ContentBundle; ctx: EngineContext }>();
  for (const raw of bundles) {
    const bundle = ContentBundleSchema.parse(raw);
    map.set(bundle.graph.system_id, { bundle, ctx: createContext(bundle) });
  }
  return { get: (id) => map.get(id) };
}
