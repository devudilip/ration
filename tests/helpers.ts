import type { FetchContext } from '../src/types';

export const NOW = new Date('2026-08-28T12:00:00Z');

export interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

/**
 * Fake FetchContext: serves canned responses per URL (or a single fallback)
 * and records every request so tests can assert what was sent — including
 * that no Authorization header is ever constructed.
 */
export function makeCtx(
  responder: (url: string) => Response | Promise<Response>,
): FetchContext & { requests: RecordedRequest[]; cached: () => unknown } {
  const requests: RecordedRequest[] = [];
  let cached: unknown;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init });
    return responder(url);
  }) as typeof globalThis.fetch;
  return {
    fetch: fetchImpl,
    now: () => NOW,
    cache: {
      get: async <T,>() => cached as T | undefined,
      set: async (value) => {
        cached = value;
      },
    },
    requests,
    cached: () => cached,
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const htmlResponse = (status = 200): Response =>
  new Response('<!doctype html><html><body>log in</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
