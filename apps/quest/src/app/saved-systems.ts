import type { ContentBundle } from '@explode/contracts';
import { checkedBundle } from './explode-client.ts';

/**
 * Systems built on request (ADR-0026), kept in this browser so they are still in the picker next
 * time. Only here: nothing is uploaded, and clearing the site's data removes them.
 *
 * What comes back out of storage is checked like anything else from outside the build.
 */

export interface SavedSystem {
  id: string;
  name: string;
  kind: 'mechanical' | 'software';
  /** Its lesson, for the picker's "done" mark. */
  first_lesson: string | null;
  /** When it was built, ms since the epoch. */
  saved_at: number;
}

function metaOf(bundle: ContentBundle, saved_at: number): SavedSystem {
  return {
    id: bundle.graph.system_id,
    name: bundle.graph.display_name,
    kind: bundle.graph.system_kind === 'mechanical' ? 'mechanical' : 'software',
    first_lesson: bundle.lessons[0]?.id ?? null,
    saved_at,
  };
}

export interface SavedSystems {
  /** Newest first. Never throws: storage that cannot be read holds nothing. */
  list(): Promise<SavedSystem[]>;
  load(id: string): Promise<ContentBundle>;
  save(bundle: ContentBundle): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Built systems kept at most; the oldest is dropped to make room. */
export const MAX_SAVED = 4;

/** In memory only: for tests, and for a browser with no usable storage. */
export class MemorySavedSystems implements SavedSystems {
  private readonly rows = new Map<string, { meta: SavedSystem; bundle: unknown }>();
  private clock = 0;

  async list(): Promise<SavedSystem[]> {
    return [...this.rows.values()].map((r) => r.meta).sort((a, b) => b.saved_at - a.saved_at);
  }

  async load(id: string): Promise<ContentBundle> {
    const row = this.rows.get(id);
    if (!row) throw new Error('It is no longer saved in this browser.');
    return checkedBundle(row.bundle);
  }

  async save(bundle: ContentBundle): Promise<void> {
    const id = bundle.graph.system_id;
    this.rows.set(id, { meta: metaOf(bundle, ++this.clock), bundle: structuredClone(bundle) });
    for (const old of (await this.list()).slice(MAX_SAVED)) this.rows.delete(old.id);
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

const DB_NAME = 'explode-built';
const STORE = 'systems';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('storage failed'));
  });
}

/** IndexedDB: a bundle is a few hundred kilobytes, more than localStorage should be asked to hold. */
export class BrowserSavedSystems implements SavedSystems {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('storage failed'));
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<SavedSystem[]> {
    try {
      const rows = (await request((await this.store('readonly')).getAll())) as Array<Partial<SavedSystem>>;
      return rows
        .filter((r): r is SavedSystem => typeof r.id === 'string' && typeof r.name === 'string' && typeof r.saved_at === 'number')
        .map((r) => ({ id: r.id, name: r.name, kind: r.kind === 'mechanical' ? ('mechanical' as const) : ('software' as const), first_lesson: typeof r.first_lesson === 'string' ? r.first_lesson : null, saved_at: r.saved_at }))
        .sort((a, b) => b.saved_at - a.saved_at);
    } catch {
      return [];
    }
  }

  async load(id: string): Promise<ContentBundle> {
    const row = (await request((await this.store('readonly')).get(id))) as { bundle?: unknown } | undefined;
    if (!row) throw new Error('It is no longer saved in this browser.');
    return checkedBundle(row.bundle);
  }

  async save(bundle: ContentBundle): Promise<void> {
    await request((await this.store('readwrite')).put({ ...metaOf(bundle, Date.now()), bundle }));
    for (const old of (await this.list()).slice(MAX_SAVED)) await this.remove(old.id);
  }

  async remove(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id));
  }
}

/** The browser's store when it has one, else memory (the session still works; nothing is kept). */
export function savedSystems(): SavedSystems {
  return typeof indexedDB === 'undefined' ? new MemorySavedSystems() : new BrowserSavedSystems();
}
