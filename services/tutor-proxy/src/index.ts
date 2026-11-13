import drivetrain from '../../../apps/quest/src/content/drivetrain.bundle.json' with { type: 'json' };
import headset from '../../../apps/quest/src/content/headset.bundle.json' with { type: 'json' };
import iwsdk from '../../../apps/quest/src/content/iwsdk.bundle.json' with { type: 'json' };
import jupiter from '../../../apps/quest/src/content/jupiter.bundle.json' with { type: 'json' };
import repoDemo from '../../../apps/quest/src/content/repo-demo.bundle.json' with { type: 'json' };
import { createRegistry } from './bundles.ts';
import type { Env } from './env.ts';
import { createExplodeService } from './explode/service.ts';
import { workerRunner } from './explode/runner.ts';
import { createHandler } from './handler.ts';

/** Every bundle the app ships; a system missing here gets 404 and the app falls back to the scripted guide. */
export const BUNDLES = [headset, repoDemo, drivetrain, jupiter, iwsdk] as const;

/** The whole proxy as one function from a request and its settings to a response (server.ts serves it). */
export const handle: (request: Request, env: Env) => Promise<Response> = createHandler({
  registry: createRegistry(BUNDLES),
  explode: createExplodeService({ runner: workerRunner() }),
});
