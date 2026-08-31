import {
  assertEqual,
  assertThrows,
  EmmettError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
} from '@event-driven-io/emmett';
import type { Request, Response } from 'express';
import { describe, it } from 'vitest';
import {
  ETagErrors,
  getETagFromIfMatch,
  getETagFromIfNoneMatch,
  getETagFromIfNotMatch,
  getETagValueFromIfMatch,
  getExpectedStreamVersionFromIfMatch,
  getExpectedStreamVersionFromIfNoneMatch,
  setETag,
  type ETag,
} from './etag';

const streamName = 'cart-123';

const fakeRequest = (headers: Record<string, string>): Request =>
  ({ headers }) as unknown as Request;

const fakeResponse = (): {
  response: Response;
  headers: Record<string, string>;
} => {
  const headers: Record<string, string> = {};

  return {
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response,
    headers,
  };
};

const assertThrowsWithCode = (errorCode: number, run: () => unknown) =>
  assertThrows(run, (error: EmmettError) => error.errorCode === errorCode);

void describe('getExpectedStreamVersionFromIfMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', () => {
    assertEqual(
      NO_CONCURRENCY_CHECK,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({}),
        streamName,
      ) as string,
    );
  });

  void it('throws PreconditionRequiredError when the header is absent and required', () => {
    assertThrowsWithCode(EmmettError.Codes.PreconditionRequiredError, () =>
      getExpectedStreamVersionFromIfMatch(fakeRequest({}), streamName, {
        required: true,
      }),
    );
  });

  void it('returns STREAM_EXISTS for the wildcard', () => {
    assertEqual(
      STREAM_EXISTS,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '*' }),
        streamName,
      ) as string,
    );
  });

  void it('returns the version when the tag names this stream', () => {
    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"cart-123:4"' }),
        streamName,
      ) as bigint,
    );
  });

  void it('throws ConcurrencyError when the tag names another stream', () => {
    assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"cart-123:4"' }),
        'cart-999',
      ),
    );
  });

  void it('accepts the bare strong form', () => {
    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"4"' }),
        streamName,
      ) as bigint,
    );
  });

  void it('accepts the weak form', () => {
    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': 'W/"4"' }),
        streamName,
      ) as bigint,
    );
  });

  void it('returns the first list member that parses and matches', () => {
    assertEqual(
      3n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"3", "4"' }),
        streamName,
      ) as bigint,
    );
    assertEqual(
      3n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"cart-123:3", "cart-123:4"' }),
        streamName,
      ) as bigint,
    );
    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(
        fakeRequest({ 'if-match': '"cart-999:3", "cart-123:4"' }),
        streamName,
      ) as bigint,
    );
  });

  void it('throws ConcurrencyError for a value that is not a version tag', () => {
    for (const headerValue of ['"2e1f6c58"', 'garbage', '']) {
      assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
        getExpectedStreamVersionFromIfMatch(
          fakeRequest({ 'if-match': headerValue }),
          streamName,
        ),
      );
    }
  });
});

void describe('getExpectedStreamVersionFromIfNoneMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', () => {
    assertEqual(
      NO_CONCURRENCY_CHECK,
      getExpectedStreamVersionFromIfNoneMatch(fakeRequest({})) as string,
    );
  });

  void it('returns STREAM_DOES_NOT_EXIST for the wildcard', () => {
    assertEqual(
      STREAM_DOES_NOT_EXIST,
      getExpectedStreamVersionFromIfNoneMatch(
        fakeRequest({ 'if-none-match': '*' }),
      ) as string,
    );
  });

  void it('throws ConcurrencyError for any list of entity tags', () => {
    for (const headerValue of [
      '"cart-123:4"',
      '"3", "4"',
      'W/"4"',
      'garbage',
    ]) {
      assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
        getExpectedStreamVersionFromIfNoneMatch(
          fakeRequest({ 'if-none-match': headerValue }),
        ),
      );
    }
  });
});

void describe('getETagFromIfMatch', () => {
  void it('returns the raw header value', () => {
    assertEqual(
      '"cart-123:4"',
      getETagFromIfMatch(fakeRequest({ 'if-match': '"cart-123:4"' })) as string,
    );
  });

  void it('throws when the header is absent', () => {
    assertThrows(
      () => getETagFromIfMatch(fakeRequest({})),
      (error: EmmettError) =>
        error.message === (ETagErrors.MISSING_IF_MATCH_HEADER as string),
    );
  });
});

void describe('getETagFromIfNoneMatch', () => {
  void it('reads the If-None-Match header', () => {
    assertEqual(
      '"cart-123:4"',
      getETagFromIfNoneMatch(
        fakeRequest({ 'if-none-match': '"cart-123:4"' }),
      ) as string,
    );
  });

  void it('throws when the header is absent', () => {
    assertThrows(
      () => getETagFromIfNoneMatch(fakeRequest({})),
      (error: EmmettError) =>
        error.message === (ETagErrors.MISSING_IF_NONE_MATCH_HEADER as string),
    );
  });
});

void describe('getETagFromIfNotMatch', () => {
  void it('reads the If-None-Match header, so a present header no longer throws', () => {
    assertEqual(
      '"cart-123:4"',
      getETagFromIfNotMatch(
        fakeRequest({ 'if-none-match': '"cart-123:4"' }),
      ) as string,
    );
  });
});

void describe('getETagValueFromIfMatch', () => {
  void it('returns the value inside a weak tag', () => {
    assertEqual(
      '4',
      getETagValueFromIfMatch(fakeRequest({ 'if-match': 'W/"4"' })),
    );
  });

  void it('returns the raw header for a strong tag', () => {
    assertEqual(
      '"4"',
      getETagValueFromIfMatch(fakeRequest({ 'if-match': '"4"' })),
    );
  });
});

void describe('setETag', () => {
  void it('writes the ETag response header', () => {
    const { response, headers } = fakeResponse();

    setETag(response, '"cart-123:4"' as ETag);

    assertEqual('"cart-123:4"', headers.etag);
  });
});
