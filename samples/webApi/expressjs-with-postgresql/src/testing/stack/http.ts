import { assertEqual, assertMatches } from '@event-driven-io/emmett';

// One parse path for every fetch+JSON read across the resources.
export const getJson = async <T>(url: string, init?: RequestInit): Promise<T> =>
  (await fetch(url, init).then((r) => r.json())) as T;

export const fetchText = (url: string): Promise<string> =>
  fetch(url).then((r) => r.text());

// `expectResponse` for a real fetch Response — mirrors the shape of
// emmett-expressjs/testing/apiSpecification.expectResponse. Header values may be
// RegExp (e.g. /^[0-9a-f]{32}$/) because assertMatches matches via isSubset.
export const expectResponse = async (
  res: Response,
  status: number,
  options?: { headers?: Record<string, unknown>; body?: unknown },
): Promise<void> => {
  assertEqual(status, res.status, "Response code doesn't match");
  if (options?.headers)
    assertMatches(Object.fromEntries(res.headers), options.headers);
  if (options?.body) assertMatches(await res.json(), options.body);
};
