import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchBundle, PROJECTS, projectsFrom, type LoadProgress } from '../src/app/projects.ts';
import { ContentBundle } from '@explode/contracts';

const CONTENT = join(import.meta.dirname, '../src/content');
const files = readdirSync(CONTENT).filter((f) => f.endsWith('.bundle.json'));
const raw = (f: string) => readFileSync(join(CONTENT, f), 'utf8');
const bundles = files.map((f) => JSON.parse(raw(f)) as { graph: { system_id: string; system_kind: string; display_name: string }; lessons: Array<{ id: string }> });

describe('the project catalog', () => {
  it('lists every generated bundle once, and says exactly what each bundle says', () => {
    expect(PROJECTS.map((p) => p.id).sort()).toEqual(bundles.map((b) => b.graph.system_id).sort());
    for (const b of bundles) {
      const p = PROJECTS.find((x) => x.id === b.graph.system_id)!;
      expect(p.kind, p.id).toBe(b.graph.system_kind);
      expect(p.name, p.id).toBe(b.graph.display_name);
      expect(p.firstLesson, p.id).toBe(b.lessons[0]?.id ?? null);
      expect(p.blurb.length, p.id).toBeGreaterThan(0);
    }
  });

  it('opens on the headset tutorial, with the models before the codebases', () => {
    expect(PROJECTS[0]!.id).toBe('system:mr-headset');
    const kinds = PROJECTS.map((p) => p.kind);
    expect(kinds.lastIndexOf('mechanical')).toBeLessThan(kinds.indexOf('software'));
  });

  it('describes bundles already in hand the same way', () => {
    const b = ContentBundle.parse(JSON.parse(raw('jupiter.bundle.json')));
    const [p] = projectsFrom([b]);
    expect(p).toMatchObject(PROJECTS.find((x) => x.id === 'system:jupiter')!);
    expect(p!.load).toBeUndefined();
  });
});

/** A fetch that streams `body` in `parts` chunks with the given headers. */
function fakeFetch(body: string, headers: Record<string, string>, parts = 4, status = 200): typeof fetch {
  return (async () => {
    const bytes = new TextEncoder().encode(body);
    const size = Math.ceil(bytes.length / parts);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
        c.close();
      },
    });
    return new Response(status === 200 ? stream : null, { status, headers });
  }) as typeof fetch;
}

describe('fetchBundle', () => {
  const body = raw('drivetrain.bundle.json');

  it('reports real progress when the size is known, then checks the bundle against the contract', async () => {
    const seen: LoadProgress[] = [];
    const b = await fetchBundle('x.json', (p) => seen.push({ ...p }), fakeFetch(body, { 'content-length': String(new TextEncoder().encode(body).length) }));
    expect(b.graph.system_id).toBe('system:ev-drivetrain');
    const fetching = seen.filter((p) => p.phase === 'fetch').map((p) => p.fraction!);
    expect(fetching[0]).toBe(0);
    expect(fetching.at(-1)).toBe(1);
    for (let i = 1; i < fetching.length; i++) expect(fetching[i]).toBeGreaterThan(fetching[i - 1]!);
    expect(seen.at(-1)!.phase).toBe('check');
  });

  it('makes no number up when the body is compressed in transit', async () => {
    const seen: LoadProgress[] = [];
    await fetchBundle('x.json', (p) => seen.push({ ...p }), fakeFetch(body, { 'content-length': '1000', 'content-encoding': 'gzip' }));
    expect(seen.filter((p) => p.phase === 'fetch').slice(1).every((p) => p.fraction === null && p.bytes > 0)).toBe(true);
  });

  it('fails on an error status and on a bundle that breaks the contract', async () => {
    await expect(fetchBundle('x.json', () => {}, fakeFetch('', {}, 1, 404))).rejects.toThrow(/404/);
    await expect(fetchBundle('x.json', () => {}, fakeFetch('{"graph":{}}', {}))).rejects.toThrow();
  });
});
