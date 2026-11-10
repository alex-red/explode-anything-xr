import { existsSync, readFileSync } from 'node:fs';
import { verifyBundle } from './bundle.ts';
import { DRIVETRAIN_BUNDLE_PATH, REPO_BUNDLE_PATH } from './paths.ts';

let failed = false;
for (const path of [DRIVETRAIN_BUNDLE_PATH, REPO_BUNDLE_PATH]) {
  if (!existsSync(path)) {
    console.error(`missing ${path} (run npm run content:generate)`);
    failed = true;
    continue;
  }
  const problems = verifyBundle(JSON.parse(readFileSync(path, 'utf8')));
  if (problems.length) {
    failed = true;
    console.error(`${path}:\n- ${problems.join('\n- ')}`);
  } else console.log(`ok ${path}`);
}
process.exit(failed ? 1 : 0);
