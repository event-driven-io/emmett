import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertOk,
} from '@event-driven-io/emmett';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ProblemDocument } from 'http-problem-details';
import { describe, it } from 'vitest';
import { toWeakETag } from './etag';
import {
  send,
  sendAccepted,
  sendCreated,
  sendNoContent,
  sendProblem,
} from './responses';

// Helper: build a one-shot Hono app, call handler with context, return the Response
const withContext = async (
  handler: (c: Context) => Response | Promise<Response>,
  url = 'http://localhost/test',
): Promise<Response> => {
  const app = new Hono();
  const pathname = new URL(url).pathname;
  app.get(pathname, (c) => handler(c));
  return app.fetch(new Request(url));
};

void describe('send', () => {
  void it('sends status code with body when body is provided', async () => {
    const response = await withContext((c) =>
      send(c, 200, { body: { message: 'ok' } }),
    );
    assertEqual(response.status, 200);
    assertDeepEqual(await response.json(), { message: 'ok' });
  });

  void it('sends status only when no body', async () => {
    const response = await withContext((c) => send(c, 204));
    assertEqual(response.status, 204);
  });

  void it('sets Location header when provided', async () => {
    const response = await withContext((c) =>
      send(c, 200, { location: '/items/1', body: 'x' }),
    );
    assertEqual(response.headers.get('location'), '/items/1');
  });

  void it('sets ETag header when provided', async () => {
    const response = await withContext((c) =>
      send(c, 200, { eTag: toWeakETag(42), body: 'x' }),
    );
    assertEqual(response.headers.get('etag'), 'W/"42"');
  });
});

void describe('sendCreated', () => {
  void it('returns 201 with id in body and Location from req.url + createdId', async () => {
    const response = await withContext(
      (c) => sendCreated(c, { createdId: 'abc' }),
      'http://localhost/items',
    );
    assertEqual(response.status, 201);
    assertDeepEqual(await response.json(), { id: 'abc' });
    assertOk(response.headers.get('location')?.endsWith('/items/abc'));
  });

  void it('merges extra body fields with id when createdId is given', async () => {
    const response = await withContext((c) =>
      sendCreated(c, { createdId: 'abc', body: { name: 'test' } }),
    );
    assertDeepEqual(await response.json(), { id: 'abc', name: 'test' });
  });

  void it('uses provided url as Location when url is given', async () => {
    const response = await withContext((c) =>
      sendCreated(c, { url: '/custom/url' }),
    );
    assertEqual(response.headers.get('location'), '/custom/url');
  });

  void it('uses body as-is when url is provided without createdId', async () => {
    const response = await withContext((c) =>
      sendCreated(c, { url: '/custom/url', body: { name: 'test' } }),
    );
    assertDeepEqual(await response.json(), { name: 'test' });
  });

  void it('uses provided url and sets id in body when both url and createdId are given', async () => {
    const response = await withContext((c) =>
      sendCreated(c, { url: '/custom/url', createdId: 'abc' }),
    );
    assertEqual(response.headers.get('location'), '/custom/url');
    assertDeepEqual(await response.json(), { id: 'abc' });
  });

  void it('sets ETag header when provided', async () => {
    const response = await withContext((c) =>
      sendCreated(c, { createdId: 'abc', eTag: toWeakETag(1) }),
    );
    assertEqual(response.headers.get('etag'), 'W/"1"');
  });
});

void describe('sendAccepted', () => {
  void it('returns 202 with Location header and no body', async () => {
    const response = await withContext((c) =>
      sendAccepted(c, { location: '/items/123' }),
    );
    assertEqual(response.status, 202);
    assertEqual(response.headers.get('location'), '/items/123');
  });

  void it('returns 202 with body and Location header', async () => {
    const response = await withContext((c) =>
      sendAccepted(c, { location: '/items/123', body: { status: 'pending' } }),
    );
    assertEqual(response.status, 202);
    assertDeepEqual(await response.json(), { status: 'pending' });
    assertEqual(response.headers.get('location'), '/items/123');
  });
});

void describe('sendNoContent', () => {
  void it('returns 204 with no body', async () => {
    const response = await withContext((c) => sendNoContent(c));
    assertEqual(response.status, 204);
  });

  void it('sets ETag header when provided', async () => {
    const response = await withContext((c) =>
      sendNoContent(c, { eTag: toWeakETag(5) }),
    );
    assertEqual(response.headers.get('etag'), 'W/"5"');
  });

  void it('sets Location header when provided', async () => {
    const response = await withContext((c) =>
      sendNoContent(c, { location: '/items/1' }),
    );
    assertEqual(response.headers.get('location'), '/items/1');
  });
});

void describe('sendProblem', () => {
  void it('returns given status code with problem+json content type', async () => {
    const response = await withContext((c) =>
      sendProblem(c, 400, { problemDetails: 'Bad input' }),
    );
    assertEqual(response.status, 400);
    assertOk(
      response.headers
        .get('content-type')
        ?.includes('application/problem+json'),
    );
  });

  void it('builds ProblemDocument from problemDetails string', async () => {
    const response = await withContext((c) =>
      sendProblem(c, 422, { problemDetails: 'Validation failed' }),
    );
    assertMatches(await response.json(), {
      detail: 'Validation failed',
      status: 422,
    });
  });

  void it('uses provided ProblemDocument directly', async () => {
    const problem = new ProblemDocument({
      type: 'https://example.com/not-found',
      title: 'Not Found',
      status: 404,
    });
    const response = await withContext((c) => sendProblem(c, 404, { problem }));
    assertMatches(await response.json(), {
      type: 'https://example.com/not-found',
      title: 'Not Found',
      status: 404,
    });
  });

  void it('uses default options when none are provided', async () => {
    const response = await withContext((c) => sendProblem(c, 500));
    assertEqual(response.status, 500);
    assertOk(
      response.headers
        .get('content-type')
        ?.includes('application/problem+json'),
    );
    assertMatches(await response.json(), {
      detail: 'Error occured!',
      status: 500,
    });
  });

  void it('sets Location header when provided', async () => {
    const response = await withContext((c) =>
      sendProblem(c, 400, { problemDetails: 'Bad input', location: '/help' }),
    );
    assertEqual(response.headers.get('location'), '/help');
  });

  void it('sets ETag header when provided', async () => {
    const response = await withContext((c) =>
      sendProblem(c, 409, { problemDetails: 'Conflict', eTag: toWeakETag(3) }),
    );
    assertEqual(response.headers.get('etag'), 'W/"3"');
  });
});
