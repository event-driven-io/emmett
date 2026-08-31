import {
  ETags as coreETags,
  StreamETags as coreStreamETags,
  assertEqual,
  assertThrows,
  EmmettError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
} from '@event-driven-io/emmett';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { describe, it } from 'vitest';
import {
  ETagErrors,
  ETags,
  StreamETags,
  getETagFromIfMatch,
  getETagFromIfNoneMatch,
  getETagFromIfNotMatch,
  getETagValueFromIfMatch,
  getExpectedStreamVersionFromIfMatch,
  getExpectedStreamVersionFromIfNoneMatch,
  HeaderNames,
  setETag,
  toWeakETag,
  type ETag,
} from './etag';

const throwsMessage =
  (message: string) =>
  (error: EmmettError): boolean =>
    error.message === message;

const contextWith = async (
  headers: Record<string, string> = {},
): Promise<Context> => {
  const app = new Hono();
  let captured: Context | undefined;

  app.get('/test', (context) => {
    captured = context;
    return context.body(null, 204);
  });

  await app.request('http://localhost/test', { headers });

  return captured!;
};

void describe('re-exports from core', () => {
  void it('shares the parsing helpers with the core package', () => {
    assertEqual(coreETags, ETags);
    assertEqual(coreStreamETags, StreamETags);
  });

  void it('uses the header names defined by RFC 9110', () => {
    assertEqual('if-match', HeaderNames.IF_MATCH);
    assertEqual('if-none-match', HeaderNames.IF_NONE_MATCH);
    assertEqual('if-none-match', HeaderNames.IF_NOT_MATCH);
    assertEqual('etag', HeaderNames.ETag);
  });

  void it('keeps emitting the weak tag through the deprecated helper', () => {
    assertEqual('W/"4"', toWeakETag(4));
  });
});

void describe('getETagFromIfMatch', () => {
  void it('returns the raw If-Match header', async () => {
    const context = await contextWith({ 'if-match': '"cart-123:4"' });

    assertEqual('"cart-123:4"', getETagFromIfMatch(context) as string);
  });

  void it('throws when the header is absent', async () => {
    const context = await contextWith();

    assertThrows(
      () => getETagFromIfMatch(context),
      throwsMessage(ETagErrors.MISSING_IF_MATCH_HEADER),
    );
  });
});

void describe('getETagFromIfNoneMatch', () => {
  void it('returns the raw If-None-Match header', async () => {
    const context = await contextWith({ 'if-none-match': '*' });

    assertEqual('*', getETagFromIfNoneMatch(context) as string);
  });

  void it('throws when the header is absent', async () => {
    const context = await contextWith();

    assertThrows(
      () => getETagFromIfNoneMatch(context),
      throwsMessage(ETagErrors.MISSING_IF_NONE_MATCH_HEADER),
    );
  });
});

void describe('getETagFromIfNotMatch', () => {
  void it('reads the If-None-Match header instead of always throwing', async () => {
    const context = await contextWith({ 'if-none-match': '"cart-123:4"' });

    assertEqual('"cart-123:4"', getETagFromIfNotMatch(context) as string);
  });

  void it('throws when the header is absent', async () => {
    const context = await contextWith();

    assertThrows(
      () => getETagFromIfNotMatch(context),
      throwsMessage(ETagErrors.MISSING_IF_NONE_MATCH_HEADER),
    );
  });
});

void describe('getExpectedStreamVersionFromIfMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', async () => {
    const context = await contextWith();

    assertEqual(
      NO_CONCURRENCY_CHECK,
      getExpectedStreamVersionFromIfMatch(context, 'cart-123') as string,
    );
  });

  void it('throws PreconditionRequiredError when the header is absent and required', async () => {
    const context = await contextWith();

    assertThrows(
      () =>
        getExpectedStreamVersionFromIfMatch(context, 'cart-123', {
          required: true,
        }),
      (error: EmmettError) =>
        error.errorCode === EmmettError.Codes.PreconditionRequiredError,
    );
  });

  void it('returns STREAM_EXISTS for the wildcard', async () => {
    const context = await contextWith({ 'if-match': '*' });

    assertEqual(
      STREAM_EXISTS,
      getExpectedStreamVersionFromIfMatch(context, 'cart-123') as string,
    );
  });

  void it('returns the version for a tag naming this stream', async () => {
    const context = await contextWith({ 'if-match': '"cart-123:4"' });

    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(context, 'cart-123') as bigint,
    );
  });

  void it('returns the version for the bare strong form', async () => {
    const context = await contextWith({ 'if-match': '"4"' });

    assertEqual(
      4n,
      getExpectedStreamVersionFromIfMatch(context, 'cart-123') as bigint,
    );
  });

  void it('throws ConcurrencyError for a value that is not a version tag', async () => {
    const context = await contextWith({ 'if-match': '"2e1f6c58"' });

    assertThrows(
      () => getExpectedStreamVersionFromIfMatch(context, 'cart-123'),
      (error: EmmettError) =>
        error.errorCode === EmmettError.Codes.ConcurrencyError,
    );
  });
});

void describe('getExpectedStreamVersionFromIfNoneMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', async () => {
    const context = await contextWith();

    assertEqual(
      NO_CONCURRENCY_CHECK,
      getExpectedStreamVersionFromIfNoneMatch(context) as string,
    );
  });

  void it('returns STREAM_DOES_NOT_EXIST for the wildcard', async () => {
    const context = await contextWith({ 'if-none-match': '*' });

    assertEqual(
      STREAM_DOES_NOT_EXIST,
      getExpectedStreamVersionFromIfNoneMatch(context) as string,
    );
  });

  void it('throws ConcurrencyError for a list of entity tags', async () => {
    const context = await contextWith({ 'if-none-match': '"cart-123:4"' });

    assertThrows(
      () => getExpectedStreamVersionFromIfNoneMatch(context),
      (error: EmmettError) =>
        error.errorCode === EmmettError.Codes.ConcurrencyError,
    );
  });
});

void describe('setETag', () => {
  void it('sets the ETag response header', async () => {
    const app = new Hono();
    app.get('/test', (context) => {
      setETag(context, StreamETags.from('cart-123', 4n));
      return context.body(null, 204);
    });

    const response = await app.request('http://localhost/test');

    assertEqual('"cart-123:4"', response.headers.get('etag'));
  });
});

void describe('getETagValueFromIfMatch', () => {
  void it('returns the value of a weak tag', async () => {
    const context = await contextWith({ 'if-match': 'W/"4"' });

    assertEqual('4', getETagValueFromIfMatch(context));
  });

  void it('returns the raw header for a strong tag', async () => {
    const context = await contextWith({ 'if-match': '"4"' });

    assertEqual('"4"', getETagValueFromIfMatch(context));
  });

  void it('throws when the header is absent', async () => {
    const context = await contextWith();

    assertThrows(
      () => getETagValueFromIfMatch(context),
      throwsMessage(ETagErrors.MISSING_IF_MATCH_HEADER),
    );
  });
});

void describe('ETag branding', () => {
  void it('accepts a core ETag where the adapter expects one', async () => {
    const app = new Hono();
    const etag: ETag = StreamETags.from('cart-123', 7n);

    app.get('/test', (context) => {
      setETag(context, etag);
      return context.body(null, 204);
    });

    const response = await app.request('http://localhost/test');

    assertEqual('"cart-123:7"', response.headers.get('etag'));
  });
});
