import { buildFromCuration, indexAnyRepo, tooSmall, type RepoSource } from '@explode/content-tools';
import { parentPort, workerData } from 'node:worker_threads';
import type { FromWorker, ToWorker } from './runner.ts';

/**
 * The slow, CPU-bound half of a build, off the server's main thread: parse the unpacked source,
 * then check each of the model's answers against that index. It reads files and nothing else:
 * no network, and the repository's code is parsed, never run.
 */
const { root, source } = workerData as { root: string; source: RepoSource };
const post = (message: FromWorker) => parentPort!.postMessage(message);

try {
  const started = Date.now();
  const repo = indexAnyRepo(root, source);
  post({ type: 'indexed', digest: repo.digest.text, counts: repo.counts, refusal: tooSmall(repo), seconds: (Date.now() - started) / 1000 });
  parentPort!.on('message', (message: ToWorker) => {
    try {
      const out = buildFromCuration(repo, source, message.answer, message.producedBy);
      post(out.ok ? { type: 'built', bundle: out.result.bundle } : { type: 'problems', problems: out.problems });
    } catch (err) {
      post({ type: 'error', message: (err as Error).message });
    }
  });
} catch (err) {
  post({ type: 'error', message: (err as Error).message });
}
