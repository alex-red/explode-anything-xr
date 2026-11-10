import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashDirectory, sha256, verifyDeployment, type Fetch, type ReleaseManifest } from '../src/manifest.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'explode-release-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, '.well-known'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets/app-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, '.well-known/x.json'), '{}');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const manifestFor = (files: Record<string, string>): ReleaseManifest => ({ created_at: '2026-11-15T00:00:00.000Z', commit: 'a'.repeat(40), dirty: false, bundles: {}, files });

/** A fake host serving `site` (path → body) under https://example.test/app/. */
const host = (site: Record<string, string>, seen: string[] = []): Fetch => async (url) => {
  seen.push(url);
  const path = new URL(url).pathname.replace(/^\/app\//, '');
  const body = site[path === '' ? 'index.html' : path];
  return body === undefined
    ? { status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    : { status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
};

const SITE = { 'index.html': '<!doctype html>', 'assets/app-abc.js': 'console.log(1)', '.well-known/x.json': '{}' };

describe('release manifest', () => {
  it('hashes every file, including dot-directories, with forward-slash paths', () => {
    const files = hashDirectory(dir);
    expect(Object.keys(files).sort()).toEqual(['.well-known/x.json', 'assets/app-abc.js', 'index.html']);
    expect(files['index.html']).toBe(sha256('<!doctype html>'));
  });

  it('passes when the deployment is byte-identical, and also checks the site root', async () => {
    const seen: string[] = [];
    const problems = await verifyDeployment('https://example.test/app', manifestFor(hashDirectory(dir)), host(SITE, seen));
    expect(problems).toEqual([]);
    expect(seen).toContain('https://example.test/app/');
    expect(seen).toContain('https://example.test/app/assets/app-abc.js');
  });

  it('reports changed, missing and unreachable files', async () => {
    const manifest = manifestFor(hashDirectory(dir));
    const changed = await verifyDeployment('https://example.test/app/', manifest, host({ ...SITE, 'assets/app-abc.js': 'console.log(2)' }));
    expect(changed.map((p) => [p.path, p.kind])).toEqual([['assets/app-abc.js', 'changed']]);

    const { 'assets/app-abc.js': _gone, ...withoutJs } = SITE;
    const missing = await verifyDeployment('https://example.test/app/', manifest, host(withoutJs));
    expect(missing.map((p) => [p.path, p.kind])).toEqual([['assets/app-abc.js', 'missing']]);

    const down = await verifyDeployment('https://example.test/app/', manifest, async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    expect(down).toHaveLength(4); // three files plus the site root
    expect(down.every((p) => p.kind === 'unreachable')).toBe(true);
  });

  it('flags a changed index.html at both its path and the site root', async () => {
    const problems = await verifyDeployment('https://example.test/app/', manifestFor(hashDirectory(dir)), host({ ...SITE, 'index.html': '<!doctype html><!-- edited -->' }));
    expect(problems.map((p) => p.path)).toEqual(['(site root)', 'index.html']);
  });
});
