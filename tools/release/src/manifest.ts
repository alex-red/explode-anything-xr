import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** What was frozen: every built file by hash, plus where it came from. */
export interface ReleaseManifest {
  created_at: string;
  /** Git commit the build was made from, and whether the working tree had uncommitted changes. */
  commit: string;
  dirty: boolean;
  /** `content_hash` of each content bundle compiled into the build, by system id. */
  bundles: Record<string, string>;
  /** sha256 of every file in the build output, by forward-slash path relative to its root. */
  files: Record<string, string>;
}

export interface Problem {
  path: string;
  kind: 'missing' | 'changed' | 'unreachable';
  detail: string;
}

export type Fetch = (url: string) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Hash every file under `dir`, dot-directories included (a host serves those too). */
export function hashDirectory(dir: string, root: string = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) hashDirectory(full, root, out);
    else out[relative(root, full).split(sep).join('/')] = sha256(readFileSync(full));
  }
  return out;
}

/**
 * Fetch every file the manifest lists from the deployed site and compare hashes. The site root
 * is checked against index.html as well, since that is the URL judges open.
 * Returns [] when the deployment is byte-identical to the frozen build.
 */
export async function verifyDeployment(baseUrl: string, manifest: ReleaseManifest, fetchFn: Fetch, concurrency = 8): Promise<Problem[]> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const targets: Array<{ path: string; url: string; expected: string }> = Object.entries(manifest.files).map(([path, expected]) => ({
    path,
    url: new URL(path, base).href,
    expected,
  }));
  const index = manifest.files['index.html'];
  if (index) targets.push({ path: '(site root)', url: base, expected: index });

  const problems: Problem[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const t = targets[next++]!;
      try {
        const res = await fetchFn(t.url);
        if (res.status !== 200) {
          problems.push({ path: t.path, kind: 'missing', detail: `HTTP ${res.status} at ${t.url}` });
          continue;
        }
        const actual = sha256(new Uint8Array(await res.arrayBuffer()));
        if (actual !== t.expected) problems.push({ path: t.path, kind: 'changed', detail: `expected ${t.expected.slice(0, 12)}, got ${actual.slice(0, 12)}` });
      } catch (err) {
        problems.push({ path: t.path, kind: 'unreachable', detail: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, targets.length)) }, worker));
  return problems.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
