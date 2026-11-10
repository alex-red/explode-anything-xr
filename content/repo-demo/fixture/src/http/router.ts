import type { Handler, HttpRequest, HttpResponse } from './types.ts';
import { json } from './types.ts';

interface Route {
  method: string;
  path: string;
  handlers: Handler[];
}

/** A minimal router. Each route runs its handlers in order; a handler calls next() to continue. */
export class Router {
  routes: Route[] = [];

  /** Register a POST route with its handler chain. */
  post(path: string, ...handlers: Handler[]): void {
    this.add('POST', path, handlers);
  }

  /** Register a GET route with its handler chain. */
  get(path: string, ...handlers: Handler[]): void {
    this.add('GET', path, handlers);
  }

  add(method: string, path: string, handlers: Handler[]): void {
    this.routes.push({ method, path, handlers });
  }

  /** Dispatch a request to the matching route's handler chain. */
  async handle(req: HttpRequest): Promise<HttpResponse> {
    const route = this.routes.find((r) => r.method === req.method && r.path === req.path);
    if (!route) return json(404, { error: 'not_found' });
    return runChain(route.handlers, req, 0);
  }
}

function runChain(handlers: Handler[], req: HttpRequest, index: number): Promise<HttpResponse> {
  const handler = handlers[index];
  if (!handler) return Promise.resolve(json(500, { error: 'chain_ended_without_response' }));
  return handler(req, () => runChain(handlers, req, index + 1));
}
