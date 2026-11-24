import { assertEqual, assertIsNull } from '@event-driven-io/emmett';
import { Hono } from 'hono';
import { describe, it } from 'vitest';
import {
  getETagFromIfNoneMatch,
  getETagFromIfNotMatch,
  type ETag,
} from './etag';

const readEtag = async (
  read: (
    context: Parameters<typeof getETagFromIfNoneMatch>[0],
  ) => ETag | undefined,
  headers: Record<string, string>,
) => {
  const app = new Hono();
  app.get('/', (context) => context.json({ etag: read(context) ?? null }));

  const response = await app.request('/', { headers });
  return ((await response.json()) as { etag: string | null }).etag;
};

void describe('If-None-Match header', () => {
  void it('reads the etag from the standard If-None-Match header', async () => {
    assertEqual(
      'W/"3"',
      await readEtag(getETagFromIfNoneMatch, { 'If-None-Match': 'W/"3"' }),
    );
  });

  void it('returns nothing when the request has no If-None-Match header', async () => {
    assertIsNull(await readEtag(getETagFromIfNoneMatch, {}));
  });

  void it('keeps the deprecated getETagFromIfNotMatch reading the if-not-match header', async () => {
    assertEqual(
      'W/"3"',
      await readEtag(getETagFromIfNotMatch, { 'If-Not-Match': 'W/"3"' }),
    );
  });
});
