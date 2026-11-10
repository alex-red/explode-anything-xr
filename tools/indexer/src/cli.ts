import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { indexRepository } from './indexer.ts';

const repo = resolve(import.meta.dirname, '../../../content/repo-demo');
const r = indexRepository({
  root: resolve(repo, 'fixture'),
  systemId: 'system:auth-service',
  displayName: 'auth-service',
  paths: JSON.parse(readFileSync(resolve(repo, 'paths.json'), 'utf8')),
});
console.log(`nodes ${r.graph.nodes.length} edges ${r.graph.edges.length} evidence ${r.evidence.length}`);
for (const e of r.graph.edges) if (e.relation !== 'imports') console.log(e.relation.padEnd(16), e.source_id, '->', e.target_id);
console.log(r.graph.paths[0]?.edge_ids);
