export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  rawBody: string;
  body?: unknown;
  clientIp: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export type Next = () => Promise<HttpResponse>;
export type Handler = (req: HttpRequest, next: Next) => Promise<HttpResponse>;

/** Build a JSON response. */
export function json(status: number, body: unknown): HttpResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}
