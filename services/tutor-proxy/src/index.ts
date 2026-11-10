import drivetrain from '../../../apps/quest/src/content/drivetrain.bundle.json' with { type: 'json' };
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from './bundles.ts';
import type { Env } from './env.ts';
import { createHandler } from './handler.ts';

const handle = createHandler({ registry: createRegistry([repoDemo, drivetrain]) });

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
