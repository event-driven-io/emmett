import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertOk,
} from '@event-driven-io/emmett';
import type { Response } from 'express';
import { ProblemDocument } from 'http-problem-details';
import { beforeEach, describe, it, vi } from 'vitest';
import { toWeakETag } from './etag';
import { Conflict, NoContent, on } from './handler';
import {
  ResponseFromEvents,
  send,
  sendAccepted,
  sendCreated,
  sendNoContent,
  sendProblem,
} from './responses';

type ProductItemAdded = {
  type: 'ProductItemAdded';
  data: { productId: string };
};
type ProductItemOutOfStock = {
  type: 'ProductItemOutOfStock';
  data: { availableQuantity: number };
};
type ShoppingCartEvent = ProductItemAdded | ProductItemOutOfStock;

// Minimal mock of Express Response
const mockResponse = () => {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name.toLowerCase()] = value;
    }),
    send: vi.fn((body: unknown) => {
      res.body = body;
    }),
    sendStatus: vi.fn((code: number) => {
      res.statusCode = code;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
    }),
    req: { url: '/items' } as Express.Request & { url: string },
  } as unknown as Response & {
    headers: Record<string, string>;
    body: unknown;
  };
  return res;
};

void describe('send', () => {
  void it('sends status code with body when body is provided', () => {
    const res = mockResponse();
    send(res, 200, { body: { message: 'ok' } });
    assertEqual(res.statusCode, 200);
    assertDeepEqual(res.body, { message: 'ok' });
  });

  void it('sends status only when no body', () => {
    const res = mockResponse();
    send(res, 204);
    assertEqual(res.statusCode, 204);
  });

  void it('sets Location header when provided', () => {
    const res = mockResponse();
    send(res, 200, { location: '/items/1', body: 'x' });
    assertEqual(res.headers['location'], '/items/1');
  });

  void it('sets ETag header when provided', () => {
    const res = mockResponse();
    send(res, 200, { eTag: toWeakETag(42), body: 'x' });
    assertEqual(res.headers['etag'], 'W/"42"');
  });
});

void describe('ResponseFromEvents', () => {
  void it('returns the HttpResponse expected by on', async () => {
    const res = mockResponse();

    const route = on(() =>
      ResponseFromEvents({
        events: [
          { type: 'ProductItemAdded', data: { productId: 'product-1' } },
        ],
        success: 202,
      }),
    );
    await route({} as never, res, vi.fn());

    assertEqual(res.statusCode, 202);
  });

  void it('maps a matching event from a complete handler result', () => {
    const res = mockResponse();
    const result = {
      events: [
        {
          type: 'ProductItemOutOfStock',
          data: { availableQuantity: 2 },
        },
        { type: 'ProductItemAdded', data: { productId: 'product-1' } },
      ] as ShoppingCartEvent[],
      appendedEvents: [],
      nextExpectedStreamVersion: 4n,
    };

    const selectResponse = () => {
      // #region express-command-result-response
      return ResponseFromEvents({
        events: result,
        success: 204,
        failure: (event) => {
          switch (event.type) {
            case 'ProductItemOutOfStock':
              return Conflict({
                problemDetails: `Only ${event.data.availableQuantity} items are available`,
              });
          }
          return undefined;
        },
      });
      // #endregion express-command-result-response
    };
    const response = selectResponse();

    response(res);

    assertEqual(res.statusCode, 409);
    assertMatches(res.body, {
      status: 409,
      detail: 'Only 2 items are available',
    });
  });

  void it('uses the complete result in a success response callback', () => {
    const res = mockResponse();
    const result = {
      events: [{ type: 'ProductItemAdded', data: { productId: 'product-1' } }],
      nextExpectedStreamVersion: 4n,
    };

    ResponseFromEvents({
      events: result,
      success: (handled) =>
        NoContent({
          eTag: toWeakETag(handled.nextExpectedStreamVersion),
        }),
    })(res);

    assertEqual(res.statusCode, 204);
    assertEqual(res.headers['etag'], 'W/"4"');
  });
});

void describe('sendCreated', () => {
  let res: ReturnType<typeof mockResponse>;

  beforeEach(() => {
    res = mockResponse();
  });

  void it('returns 201 with id in body and Location from req.url + createdId', () => {
    sendCreated(res, { createdId: 'abc' });
    assertEqual(res.statusCode, 201);
    assertDeepEqual(res.body, { id: 'abc' });
    assertEqual(res.headers['location'], '/items/abc');
  });

  void it('merges extra body fields with id when createdId is given', () => {
    sendCreated(res, { createdId: 'abc', body: { name: 'test' } });
    assertDeepEqual(res.body, { id: 'abc', name: 'test' });
  });

  void it('uses provided url as Location when url is given', () => {
    sendCreated(res, { url: '/custom/url' });
    assertEqual(res.headers['location'], '/custom/url');
  });

  void it('uses body as-is when url is provided without createdId', () => {
    sendCreated(res, { url: '/custom/url', body: { name: 'test' } });
    assertDeepEqual(res.body, { name: 'test' });
  });

  void it('uses provided url and sets id in body when both url and createdId are given', () => {
    sendCreated(res, { url: '/custom/url', createdId: 'abc' });
    assertEqual(res.headers['location'], '/custom/url');
    assertDeepEqual(res.body, { id: 'abc' });
  });

  void it('sets ETag header when provided', () => {
    sendCreated(res, { createdId: 'abc', eTag: toWeakETag(1) });
    assertEqual(res.headers['etag'], 'W/"1"');
  });
});

void describe('sendAccepted', () => {
  void it('returns 202 with Location header and no body', () => {
    const res = mockResponse();
    sendAccepted(res, { location: '/items/123' });
    assertEqual(res.statusCode, 202);
    assertEqual(res.headers['location'], '/items/123');
  });

  void it('returns 202 with body and Location header', () => {
    const res = mockResponse();
    sendAccepted(res, { location: '/items/123', body: { status: 'pending' } });
    assertEqual(res.statusCode, 202);
    assertDeepEqual(res.body, { status: 'pending' });
    assertEqual(res.headers['location'], '/items/123');
  });
});

void describe('sendNoContent', () => {
  void it('returns 204 with no body', () => {
    const res = mockResponse();
    sendNoContent(res);
    assertEqual(res.statusCode, 204);
  });

  void it('sets ETag header when provided', () => {
    const res = mockResponse();
    sendNoContent(res, { eTag: toWeakETag(5) });
    assertEqual(res.headers['etag'], 'W/"5"');
  });

  void it('sets Location header when provided', () => {
    const res = mockResponse();
    sendNoContent(res, { location: '/items/1' });
    assertEqual(res.headers['location'], '/items/1');
  });
});

void describe('sendProblem', () => {
  void it('returns given status code with problem+json content type', () => {
    const res = mockResponse();
    sendProblem(res, 400, { problemDetails: 'Bad input' });
    assertEqual(res.statusCode, 400);
    assertEqual(res.headers['content-type'], 'application/problem+json');
  });

  void it('builds ProblemDocument from problemDetails string', () => {
    const res = mockResponse();
    sendProblem(res, 422, { problemDetails: 'Validation failed' });
    assertMatches(res.body, { detail: 'Validation failed', status: 422 });
  });

  void it('uses provided ProblemDocument directly', () => {
    const res = mockResponse();
    const problem = new ProblemDocument({
      type: 'https://example.com/not-found',
      title: 'Not Found',
      status: 404,
    });
    sendProblem(res, 404, { problem });
    assertOk(res.body === problem);
  });

  void it('uses default options when none are provided', () => {
    const res = mockResponse();
    sendProblem(res, 500);
    assertEqual(res.statusCode, 500);
    assertEqual(res.headers['content-type'], 'application/problem+json');
    assertMatches(res.body, { detail: 'Error occured!', status: 500 });
  });

  void it('sets Location header when provided', () => {
    const res = mockResponse();
    sendProblem(res, 400, { problemDetails: 'Bad input', location: '/help' });
    assertEqual(res.headers['location'], '/help');
  });

  void it('sets ETag header when provided', () => {
    const res = mockResponse();
    sendProblem(res, 409, { problemDetails: 'Conflict', eTag: toWeakETag(3) });
    assertEqual(res.headers['etag'], 'W/"3"');
  });
});
