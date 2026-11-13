import type { ContentBundle } from '@explode/contracts';
import { buildFromCuration, indexAnyRepo, tooSmall, type RepoIndex, type RepoSource } from '@explode/content-tools';
import { Worker } from 'node:worker_threads';

/**
 * Runs the parsing half of a build. The real runner uses a worker thread, so a large repository
 * cannot stall tutor turns, with a time limit and a memory limit that end it. The inline runner
 * does the same work on the calling thread, for tests and the command-line script.
 */

export interface Indexed {
  /** The digest the model is shown. */
  digest: string;
  counts: RepoIndex['counts'];
  /** Why this index cannot be exploded; null when it can. */
  refusal: string | null;
  seconds: number;
}

export type Submitted = { ok: true; bundle: ContentBundle } | { ok: false; problems: string[] };

export interface BuildSession {
  indexed: Promise<Indexed>;
  /** Check one of the model's answers; a fitting one comes back as the finished bundle. */
  submit(answer: string, producedBy: { provider: string; model: string; created_at: string }): Promise<Submitted>;
  dispose(): void;
}

export type BuildRunner = (root: string, source: RepoSource) => BuildSession;

export type ToWorker = { type: 'curation'; answer: string; producedBy: { provider: string; model: string; created_at: string } };
export type FromWorker =
  | ({ type: 'indexed' } & Indexed)
  | { type: 'built'; bundle: ContentBundle }
  | { type: 'problems'; problems: string[] }
  | { type: 'error'; message: string };

export interface WorkerLimits {
  /** Seconds the parse may take before it is ended. */
  indexTimeoutS: number;
  /** Megabytes of heap the worker may use. */
  maxHeapMb: number;
}

export const DEFAULT_WORKER_LIMITS: WorkerLimits = { indexTimeoutS: 120, maxHeapMb: 1024 };

export function workerRunner(limits: WorkerLimits = DEFAULT_WORKER_LIMITS): BuildRunner {
  return (root, source) => {
    const worker = new Worker(new URL('./build-worker.ts', import.meta.url), {
      workerData: { root, source },
      resourceLimits: { maxOldGenerationSizeMb: limits.maxHeapMb },
    });
    let waiting: { resolve: (m: FromWorker) => void; reject: (e: Error) => void } | null = null;
    let failed: Error | null = null;
    const fail = (err: Error) => {
      failed = err;
      waiting?.reject(err);
      waiting = null;
    };
    worker.on('message', (m: FromWorker) => {
      waiting?.resolve(m);
      waiting = null;
    });
    worker.on('error', (err) => fail(/memory/i.test(err.message) ? new Error('reading this repository needs more memory than this server has') : err));
    worker.on('exit', () => fail(new Error('the build stopped before it finished')));
    const next = () =>
      new Promise<FromWorker>((resolve, reject) => {
        if (failed) reject(failed);
        else waiting = { resolve, reject };
      });

    const timer = setTimeout(() => {
      fail(new Error(`reading this repository took longer than ${limits.indexTimeoutS} seconds`));
      void worker.terminate();
    }, limits.indexTimeoutS * 1000);
    const indexed = next().then((m) => {
      clearTimeout(timer);
      if (m.type === 'indexed') return { digest: m.digest, counts: m.counts, refusal: m.refusal, seconds: m.seconds };
      throw new Error(m.type === 'error' ? m.message : 'the build answered out of turn');
    });
    indexed.catch(() => clearTimeout(timer));
    return {
      indexed,
      async submit(answer, producedBy) {
        const reply = next();
        worker.postMessage({ type: 'curation', answer, producedBy } satisfies ToWorker);
        const m = await reply;
        if (m.type === 'built') return { ok: true, bundle: m.bundle };
        if (m.type === 'problems') return { ok: false, problems: m.problems };
        throw new Error(m.type === 'error' ? m.message : 'the build answered out of turn');
      },
      dispose() {
        clearTimeout(timer);
        worker.removeAllListeners('exit');
        void worker.terminate();
      },
    };
  };
}

/** The same work on the calling thread. No time or memory limit: for tests and the script only. */
export const inlineRunner: BuildRunner = (root, source) => {
  let repo: RepoIndex | null = null;
  const indexed = (async (): Promise<Indexed> => {
    const started = Date.now();
    repo = indexAnyRepo(root, source);
    return { digest: repo.digest.text, counts: repo.counts, refusal: tooSmall(repo), seconds: (Date.now() - started) / 1000 };
  })();
  return {
    indexed,
    async submit(answer, producedBy) {
      await indexed;
      const out = buildFromCuration(repo!, source, answer, producedBy);
      return out.ok ? { ok: true, bundle: out.result.bundle } : { ok: false, problems: out.problems };
    },
    dispose() {},
  };
};
