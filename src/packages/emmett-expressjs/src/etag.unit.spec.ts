import { assertEqual, assertIsNull } from '@event-driven-io/emmett';
import express, { type Request } from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import {
  getETagFromIfNoneMatch,
  getETagFromIfNotMatch,
  type ETag,
} from './etag';

const readEtag = async (
  read: (request: Request) => ETag | undefined,
  headers: Record<string, string>,
) => {
  const app = express();
  app.get('/', (req, res) => {
    res.json({ etag: read(req) ?? null });
  });

  const response = await request(app).get('/').set(headers);
  return (response.body as { etag: string | null }).etag;
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
