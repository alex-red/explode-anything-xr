import type { RepoSource } from '@explode/content-tools';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_SOURCE_BYTES, MAX_SOURCE_FILES, MAX_TARBALL_BYTES, MAX_UNPACKED_BYTES, isManifest, isReadableSource } from './source-files.ts';
import { unpackTarGz } from './tar.ts';

/**
 * Everything this server asks of GitHub (ADR-0026). Two fixed hosts, public repositories only,
 * read-only. Nothing a repository says is ever used as an address: the owner and name are checked
 * against GitHub's own naming rules before they go into a URL, and a response that arrives from
 * any other host is refused.
 */

const API = 'https://api.github.com';
const CODELOAD = 'https://codeload.github.com';
const ALLOWED_HOSTS = new Set(['api.github.com', 'codeload.github.com']);
const TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface RepoRef {
  owner: string;
  name: string;
}

/** Something the learner can be told and can act on. Anything else is a failure of ours or of the network. */
export class Refusal extends Error {}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Read `owner/name` out of what the learner typed or pasted: a github.com address in any of its
 * usual forms, or the bare pair. Null when it is not one; nothing is guessed from a loose name.
 */
export function parseRepoQuery(query: string): RepoRef | null {
  let q = query.trim();
  const ssh = /^git@github\.com:(.+)$/i.exec(q);
  if (ssh) q = ssh[1]!;
  else {
    const web = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(q);
    if (web) q = web[1]!;
    else if (/[:\s]|^\/|\/\//.test(q)) return null; // some other address, or free text
  }
  const [owner, rawName, ...rest] = q.split(/[?#]/)[0]!.split('/');
  if (!owner || !rawName) return null;
  // A bare pair must be exactly two segments; an address may go on (/tree/main, /blob/…).
  if (!ssh && !/github\.com/i.test(query) && rest.length > 0) return null;
  const name = rawName.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

export interface GitHubOptions {
  fetchImpl?: typeof fetch;
  /** Optional token for a higher rate limit. Never needed for a public repository. */
  token?: string;
}

async function get(url: string, accept: string, opts: GitHubOptions, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    headers: {
      accept,
      'user-agent': 'explode-anything-builder',
      'x-github-api-version': '2022-11-28',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // A redirect (a renamed repository) must still end on GitHub.
  if (res.url && !ALLOWED_HOSTS.has(new URL(res.url).host)) throw new Error('GitHub redirected somewhere else');
  if (res.status === 403 || res.status === 429) {
    throw new Refusal('GitHub is limiting how often this server may ask. Try again in a while.');
  }
  return res;
}

export interface Research {
  source: RepoSource;
  default_branch: string;
  counts: { files_total: number; files_readable: number; bytes_readable: number };
}

/**
 * Read-only research before anything is proposed: does it exist, which commit would be read,
 * what licence GitHub reports, and how many files could be indexed. Throws `Refusal` with a
 * reason the learner can read when the repository cannot be built.
 */
export async function researchRepository(ref: RepoRef, opts: GitHubOptions = {}): Promise<Research> {
  const base = `${API}/repos/${ref.owner}/${ref.name}`;
  const repoRes = await get(base, 'application/vnd.github+json', opts);
  if (repoRes.status === 404) throw new Refusal(`There is no public repository ${ref.owner}/${ref.name} on GitHub. Private repositories cannot be read.`);
  if (!repoRes.ok) throw new Error(`GitHub answered ${repoRes.status} for the repository`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo: any = await repoRes.json();
  if (repo?.private === true) throw new Refusal('That repository is private. Only public repositories can be read.');
  const fullName = String(repo?.full_name ?? '');
  const [owner, name] = fullName.split('/');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name)) throw new Error('GitHub returned a repository name this server does not accept');
  const branch = String(repo?.default_branch ?? '');
  if (!branch) throw new Refusal('That repository has no default branch to read. It may be empty.');

  const commitRes = await get(`${API}/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, 'application/vnd.github.sha', opts);
  if (commitRes.status === 404 || commitRes.status === 409 || commitRes.status === 422) throw new Refusal('That repository has no commits to read.');
  if (!commitRes.ok) throw new Error(`GitHub answered ${commitRes.status} for the commit`);
  const commit = (await commitRes.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('GitHub returned something that is not a commit id');

  const treeRes = await get(`${API}/repos/${owner}/${name}/git/trees/${commit}?recursive=1`, 'application/vnd.github+json', opts);
  if (!treeRes.ok) throw new Error(`GitHub answered ${treeRes.status} for the file list`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree: any = await treeRes.json();
  if (tree?.truncated === true) throw new Refusal('That repository has more files than GitHub will list in one answer, which is more than this server reads.');
  let filesTotal = 0;
  let filesReadable = 0;
  let bytesReadable = 0;
  for (const entry of Array.isArray(tree?.tree) ? tree.tree : []) {
    if (entry?.type !== 'blob' || typeof entry.path !== 'string') continue;
    filesTotal++;
    const size = Number(entry.size ?? 0);
    if (isReadableSource(entry.path, size)) {
      filesReadable++;
      bytesReadable += size;
    }
  }
  if (filesReadable === 0) {
    const language = typeof repo?.language === 'string' && repo.language ? ` GitHub lists it as ${repo.language.slice(0, 40)}.` : '';
    throw new Refusal(`No TypeScript or JavaScript source was found in ${fullName}. Those are the only languages this can read so far.${language}`);
  }
  if (filesReadable > MAX_SOURCE_FILES || bytesReadable > MAX_SOURCE_BYTES) {
    throw new Refusal(`${fullName} has ${filesReadable} source files, which is more than this server reads at once (${MAX_SOURCE_FILES}).`);
  }

  const spdx = typeof repo?.license?.spdx_id === 'string' && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id.slice(0, 40) : null;
  const licenseName = typeof repo?.license?.name === 'string' ? repo.license.name.slice(0, 80) : null;
  return {
    source: {
      full_name: fullName,
      url: `https://github.com/${fullName}`,
      commit,
      license: spdx ? { spdx, name: licenseName ?? spdx } : licenseName ? { spdx: 'NOASSERTION', name: licenseName } : null,
    },
    default_branch: branch.slice(0, 200),
    counts: { files_total: filesTotal, files_readable: filesReadable, bytes_readable: bytesReadable },
  };
}

/**
 * Download the repository at `source.commit` and write its readable source files under `dir`.
 * Only regular files that pass `isReadableSource` (and package manifests) are written; the
 * repository's code is never installed or run. Returns how many source files were written.
 */
export async function downloadSource(source: RepoSource, dir: string, opts: GitHubOptions = {}): Promise<number> {
  const res = await get(`${CODELOAD}/${source.full_name}/tar.gz/${source.commit}`, 'application/x-gzip', opts, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status} for the download`);
  let sourceFiles = 0;
  let sourceBytes = 0;
  await unpackTarGz(res.body as unknown as AsyncIterable<Uint8Array>, {
    strip: 1,
    maxCompressedBytes: MAX_TARBALL_BYTES,
    maxUnpackedBytes: MAX_UNPACKED_BYTES,
    want: (path, size) => {
      if (isManifest(path, size)) return true;
      if (!isReadableSource(path, size)) return false;
      // The proposal counted these from GitHub's list; hold the same caps against the archive itself.
      if (sourceFiles >= MAX_SOURCE_FILES || sourceBytes + size > MAX_SOURCE_BYTES) return false;
      sourceFiles++;
      sourceBytes += size;
      return true;
    },
    onFile: (path, data) => {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    },
  });
  return sourceFiles;
}
