import type { ContentBundle, EngineEvent, SceneState } from '@explode/contracts';
import { EngineEvent as EngineEventSchema } from '@explode/contracts';
import { createContext, reduce, replay, undo, type EngineContext } from '@explode/lesson-engine';

type Listener = (state: SceneState, event: EngineEvent | null) => void;

const STORAGE_KEY = 'explode:session:v1';
/** Lessons finished at least once, kept apart from the event logs so Reset and Undo never erase them. */
const DONE_KEY = 'explode:done:v1';

interface Persisted {
  active_system: string;
  logs: Record<string, { content_hash: string; lesson_id: string | null; events: EngineEvent[] }>;
}

/**
 * Event-sourced store (ADR-0009/0016). The event log is the only source of truth; state is
 * replayed from it, persisted on every event, and restored after a killed session.
 */
export class Store {
  ctx!: EngineContext;
  state!: SceneState;
  private events: EngineEvent[] = [];
  private lessonId: string | null = null;
  private listeners = new Set<Listener>();

  constructor(private readonly bundles: ReadonlyMap<string, ContentBundle>) {}

  get log(): readonly EngineEvent[] {
    return this.events;
  }

  get systemId(): string {
    return this.ctx.bundle.graph.system_id;
  }

  /** Load a system, restoring its persisted log if it matches the same content hash. */
  load(systemId: string, lessonId?: string | null, restore = true): void {
    const bundle = this.bundles.get(systemId);
    if (!bundle) throw new Error(`unknown system ${systemId}`);
    this.ctx = createContext(bundle);
    this.lessonId = lessonId === undefined ? (bundle.lessons[0]?.id ?? null) : lessonId;
    const saved = restore ? readPersisted()?.logs[systemId] : undefined;
    this.events = [];
    if (saved && saved.content_hash === bundle.content_hash) {
      this.lessonId = saved.lesson_id;
      this.events = saved.events.filter((e) => EngineEventSchema.safeParse(e).success);
    }
    this.state = replay(this.ctx, this.events, this.lessonId);
    this.persist();
    this.emit(null);
  }

  dispatch(event: EngineEvent): void {
    const next = reduce(this.ctx, this.state, event);
    if (next === this.state) return; // rejected / no-op events are not logged
    this.events.push(event);
    this.state = next;
    this.persist();
    this.emit(event);
  }

  undo(): void {
    const shorter = undo(this.events);
    if (shorter.length === this.events.length) return;
    this.events = shorter;
    this.state = replay(this.ctx, this.events, this.lessonId);
    this.persist();
    this.emit(null);
  }

  /** Full reset of the current system (clears its log). */
  restart(lessonId: string | null = this.lessonId): void {
    this.lessonId = lessonId;
    this.events = [];
    this.state = replay(this.ctx, [], lessonId);
    this.persist();
    this.emit(null);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Forget all saved progress for every system (testing only; the caller then reloads a system). */
  static clearSaved(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(DONE_KEY);
    } catch {
      // Storage unavailable: there is nothing saved to clear.
    }
  }

  /** Record that a lesson was finished. */
  static markDone(lessonId: string): void {
    const done = Store.doneLessons();
    if (done.has(lessonId)) return;
    done.add(lessonId);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...done].sort()));
    } catch {
      // Storage unavailable: finishing still works, it is just not remembered.
    }
  }

  /** Every lesson finished at least once, on this device. */
  static doneLessons(): Set<string> {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  static lastActiveSystem(): string | null {
    return readPersisted()?.active_system ?? null;
  }

  private emit(event: EngineEvent | null): void {
    for (const fn of this.listeners) fn(this.state, event);
  }

  private persist(): void {
    try {
      const data = readPersisted() ?? { active_system: this.systemId, logs: {} };
      data.active_system = this.systemId;
      data.logs[this.systemId] = {
        content_hash: this.ctx.bundle.content_hash,
        lesson_id: this.lessonId,
        events: this.events.slice(-500),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable (private mode, quota); the session still works in memory.
    }
  }
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}
