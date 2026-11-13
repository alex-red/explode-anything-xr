import type { RepoSource } from '../src/index.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A small repository written for these tests, shaped like one nobody prepared: a capitalised
 * directory, imports with no extension, with `.js`, and through a tsconfig alias, a `$` in a
 * name, two functions with the same name, and a test file that must not be read.
 */
export const FIXTURE_FILES: Record<string, string> = {
  'package.json': '{ "name": "fixture-shop", "version": "1.0.0" }\n',
  'tsconfig.json': '{\n  // aliases\n  "compilerOptions": { "baseUrl": ".", "paths": { "@store/*": ["src/store/*"], } },\n}\n',
  'src/Api/Server.ts': `import { Router } from '../core/router';
import { loadConfig } from '../util/config.js';

/** Starts the service and hands every request to the router. */
export class Server {
  private readonly router = new Router();
  start(path: string): string {
    loadConfig();
    return this.router.route(path);
  }
}
`,
  'src/Api/handlers.ts': `import { authenticate } from '../core/auth';
import { endSession } from '@store/sessions';

/** Checks a login and opens a session. */
export function handleLogin(name: string): string {
  return authenticate(name);
}

export function handleLogout(id: string): string {
  return endSession(id);
}
`,
  'src/core/router.ts': `import { handleLogin, handleLogout } from '../Api/handlers';

/** Sends a path to its handler. */
export class Router {
  route(path: string): string {
    if (path === '/logout') return handleLogout(path);
    return handleLogin(path);
  }
}
`,
  'src/core/auth.ts': `import { findUser } from '../store/users';
import { createSession } from '@store/sessions';

/** Looks the user up and, when found, creates a session. */
export function authenticate(name: string): string {
  const user = findUser(name);
  return user ? createSession(user) : hashPassword(name);
}

export function hashPassword(text: string): string {
  return text.split('').reverse().join('');
}
`,
  'src/core/auth.test.ts': `import { authenticate } from './auth';
export function neverIndexed(): string {
  return authenticate('x');
}
`,
  'src/store/users.ts': `import { query } from './db';

export function findUser(name: string): string {
  return query('users:' + name);
}
`,
  'src/store/sessions.ts': `import { query } from './db';

export function createSession(user: string): string {
  return query('create:' + user);
}

export function endSession(id: string): string {
  return query('end:' + id);
}
`,
  'src/store/db.ts': `import { log } from '../util/log';

/** The one place that talks to the database. */
export function query(text: string): string {
  return log(text);
}
`,
  'src/util/log.ts': `export function log(message: string): string {
  return $stamp(message);
}

export function $stamp(message: string): string {
  return '[log] ' + message;
}
`,
  'src/util/config.ts': `import { log } from './log';

export function loadConfig(): string {
  return log('config');
}
`,
  'src/util/query.ts': `/** Same name as the store's query: only one of the two can be drawn. */
export function query(text: string): string {
  return text.trim();
}
`,
};

export const FIXTURE_SOURCE: RepoSource = {
  full_name: 'Example-Org/Fixture.Shop',
  url: 'https://github.com/Example-Org/Fixture.Shop',
  commit: 'c0ffee1234567890c0ffee1234567890c0ffee12',
  license: { spdx: 'MIT', name: 'MIT License' },
};

/** What a model might answer for the fixture. Ids and paths are as the digest shows them: lowercase. */
export const FIXTURE_ANSWER = {
  groups: [
    { id: 'entry', label: 'Requests come in', summary: 'The server and the handlers that receive each request.', members: ['src/api'] },
    { id: 'rules', label: 'Routing and login', summary: 'Chooses a handler and decides whether a login is valid.', members: ['src/core'] },
    { id: 'storage', label: 'Stored data', summary: 'Users and sessions, behind one query function.', members: ['src/store'] },
    { id: 'support', label: 'Logging and config', summary: 'Small helpers the rest of the code leans on.', members: ['src/util'] },
  ],
  spotlight: [
    { id: 'fn:src/core/auth.ts#authenticate', why: 'Every login passes through it.' },
    { id: 'fn:src/store/db.ts#query', why: 'The single door to the database.' },
  ],
  entry_points: ['class:src/api/server.ts#server'],
};

export function writeFixture(dir: string, files: Record<string, string> = FIXTURE_FILES): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}
