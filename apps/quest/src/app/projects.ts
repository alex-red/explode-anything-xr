import { ContentBundle } from '@explode/contracts';

/**
 * Every system the app can put on the stage, known before its bundle is loaded: enough to list it
 * in the project picker and to order the lessons. The bundle itself is fetched when the system is
 * first opened. `test/projects.test.ts` checks this list against the generated bundles, so a
 * regenerated bundle cannot drift from what the picker says.
 */
export interface ProjectInfo {
  id: string;
  kind: 'mechanical' | 'software';
  /** The bundle's `graph.display_name`. */
  name: string;
  /** The bundle's first lesson, for the picker's "done" mark; null when it has none. */
  firstLesson: string | null;
  /** One line for the picker: what you do with it. Presentation only. */
  blurb: string;
  /** Built on request in this browser (ADR-0026), not shipped with the app. */
  built?: boolean;
}

/** The picker line of a system built on request: a repository, or a subject a model drafted. */
export const BUILT_BLURB = 'Built for you from its source on GitHub';
export const DRAFT_BLURB = 'Drafted for you by an AI model; not checked';

/** The project entry for a system built in an earlier visit and kept in this browser; `load` reads it back. */
export function savedProject(meta: { id: string; name: string; kind: 'mechanical' | 'software'; first_lesson: string | null }, load: (id: string) => Promise<ContentBundle>): Project {
  return {
    id: meta.id,
    kind: meta.kind,
    name: meta.name,
    firstLesson: meta.first_lesson,
    blurb: meta.kind === 'mechanical' ? DRAFT_BLURB : BUILT_BLURB,
    built: true,
    load: async (onProgress) => {
      onProgress({ phase: 'check', fraction: null, bytes: 0 });
      return load(meta.id);
    },
  };
}

/** The project entry for a bundle built on request. */
export function builtProject(bundle: ContentBundle): Project {
  const kind = bundle.graph.system_kind === 'mechanical' ? 'mechanical' : 'software';
  return { id: bundle.graph.system_id, kind, name: bundle.graph.display_name, firstLesson: bundle.lessons[0]?.id ?? null, blurb: kind === 'mechanical' ? DRAFT_BLURB : BUILT_BLURB, built: true };
}

/** Where a load has got to; the loading view shows it. */
export interface LoadProgress {
  phase: 'fetch' | 'check' | 'build';
  /** 0..1, or null while the size is unknown. */
  fraction: number | null;
  /** Bytes received so far (fetch phase). */
  bytes: number;
}

export type ProgressFn = (p: LoadProgress) => void;

export interface Project extends ProjectInfo {
  /** Fetch and validate the bundle. Absent when the bundle was handed to the app already loaded. */
  load?: (onProgress: ProgressFn) => Promise<ContentBundle>;
}

/** The catalog, in picker order: the opening tutorial first, then the other models, then the codebases. */
export const PROJECTS: readonly ProjectInfo[] = [
  { id: 'system:mr-headset', kind: 'mechanical', name: 'Mixed-reality headset (teaching model)', firstLesson: 'lesson:headset-tutorial', blurb: 'Cut its camera link and watch your room go dark' },
  { id: 'system:ev-drivetrain', kind: 'mechanical', name: 'Simplified EV drivetrain (teaching model)', firstLesson: 'lesson:drivetrain-tutorial', blurb: 'Unplug the inverter and find what stops' },
  { id: 'system:jupiter', kind: 'mechanical', name: 'Jupiter (teaching model)', firstLesson: 'lesson:jupiter-aurora', blurb: 'Peel the planet layer by layer to its core' },
  { id: 'system:auth-service', kind: 'software', name: 'auth-service (sample TypeScript service)', firstLesson: 'lesson:repo-login', blurb: 'Trace a login to its source, break it, fix it' },
  { id: 'system:iwsdk', kind: 'software', name: 'Immersive Web SDK (meta/immersive-web-sdk)', firstLesson: 'lesson:sdk-tour', blurb: 'The open source framework this app runs on' },
];

/** Projects for bundles that are already in hand (tests, or a build that ships them inline). */
export function projectsFrom(bundles: readonly ContentBundle[]): Project[] {
  return bundles.map((b) => {
    const known = PROJECTS.find((p) => p.id === b.graph.system_id);
    return {
      id: b.graph.system_id,
      kind: b.graph.system_kind === 'mechanical' ? 'mechanical' : 'software',
      name: b.graph.display_name,
      firstLesson: b.lessons[0]?.id ?? null,
      blurb: known?.blurb ?? '',
    };
  });
}

/**
 * Fetch a bundle from `url`, reporting bytes as they arrive, then validate it against the
 * contract. The fraction is real when the server says how many bytes are coming and the body is
 * not compressed in transit (then Content-Length counts the compressed bytes); otherwise it is
 * null and the loading view shows an indeterminate sweep instead of a made-up number.
 */
export async function fetchBundle(url: string, onProgress: ProgressFn, fetchFn: typeof fetch = fetch): Promise<ContentBundle> {
  onProgress({ phase: 'fetch', fraction: 0, bytes: 0 });
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'} for ${url}`);
  const length = Number(res.headers.get('content-length') ?? '');
  const encoded = !!res.headers.get('content-encoding');
  const total = Number.isFinite(length) && length > 0 && !encoded ? length : null;
  let text: string;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      onProgress({ phase: 'fetch', fraction: total ? Math.min(1, bytes / total) : null, bytes });
    }
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
    onProgress({ phase: 'fetch', fraction: 1, bytes: text.length });
  }
  onProgress({ phase: 'check', fraction: null, bytes: text.length });
  // Let the bar paint "checking" before the parse holds the main thread.
  await new Promise((r) => setTimeout(r, 0));
  return ContentBundle.parse(JSON.parse(text));
}
