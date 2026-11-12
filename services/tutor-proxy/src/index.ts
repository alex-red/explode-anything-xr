import drivetrain from '../../../apps/quest/src/content/drivetrain.bundle.json' with { type: 'json' };
import headset from '../../../apps/quest/src/content/headset.bundle.json' with { type: 'json' };
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from './bundles.ts';
import type { Env } from './env.ts';
import { createHandler } from './handler.ts';

/** Every bundle the app ships; a system missing here gets 404 and the app falls back to the scripted guide. */
export const BUNDLES = [headset, repoDemo, drivetrain] as const;

const handle = createHandler({ registry: createRegistry(BUNDLES) });

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
