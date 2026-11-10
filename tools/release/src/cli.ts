/**
 * Freeze check (docs/FINAL_PLAN.md A6, QA AT-13).
 *
 *   node tools/release/src/cli.ts manifest [distDir] [outFile]
 *       Hash a finished build and write the release manifest. Does not build anything.
 *   node tools/release/src/cli.ts verify <url> [manifestFile]
 *       Fetch every file from the deployed URL and compare it with the manifest.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hashDirectory, verifyDeployment, type ReleaseManifest } from './manifest.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_DIST = join(ROOT, 'apps/quest/dist');
const DEFAULT_MANIFEST = join(ROOT, 'release/manifest.json');
const BUNDLES = ['apps/quest/src/content/drivetrain.bundle.json', 'apps/quest/src/content/repo-demo.bundle.json'];

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, a, b] = process.argv.slice(2);

  if (command === 'manifest') {
    const dist = resolve(a ?? DEFAULT_DIST);
    const out = resolve(b ?? DEFAULT_MANIFEST);
    if (!existsSync(join(dist, 'index.html'))) fail(`no build found at ${dist} (index.html is missing). Build the app first.`);
    const bundles: Record<string, string> = {};
    for (const rel of BUNDLES) {
      const bundle = JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as { graph: { system_id: string }; content_hash: string };
      bundles[bundle.graph.system_id] = bundle.content_hash;
    }
    const manifest: ReleaseManifest = {
      created_at: new Date().toISOString(),
      commit: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      bundles,
      files: hashDirectory(dist),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${out}: ${Object.keys(manifest.files).length} files at commit ${manifest.commit.slice(0, 8)}`);
    if (manifest.dirty) console.warn('warning: the working tree has uncommitted changes, so this build is not exactly that commit.');
    return;
  }

  if (command === 'verify') {
    if (!a) fail('usage: verify <url> [manifestFile]');
    const file = resolve(b ?? DEFAULT_MANIFEST);
    if (!existsSync(file)) fail(`no manifest at ${file}. Run the manifest command on the release build first.`);
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as ReleaseManifest;
    const problems = await verifyDeployment(a, manifest, (url) => fetch(url, { cache: 'no-store', redirect: 'follow' }));
    const total = Object.keys(manifest.files).length;
    if (problems.length === 0) {
      console.log(`ok: ${a} matches the frozen build (${total} files, commit ${manifest.commit.slice(0, 8)}, checked ${new Date().toISOString()})`);
      return;
    }
    console.error(`${problems.length} problem(s) at ${a} against commit ${manifest.commit.slice(0, 8)}:`);
    for (const p of problems) console.error(`- ${p.kind.padEnd(11)} ${p.path}: ${p.detail}`);
    process.exit(1);
  }

  fail('usage: manifest [distDir] [outFile] | verify <url> [manifestFile]');
}

await main();
