import { describe, it } from 'vitest';
import { EmmettError, type ConcurrencyError } from '../errors';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
} from '../eventStore';
import { assertDeepEqual, assertEqual, assertThrows } from '../testing';
import { StreamETags } from './streamETag';

const streamName = 'cart-123';

const assertThrowsWithCode = (errorCode: number, run: () => unknown) =>
  assertThrows(run, (error: EmmettError) => error.errorCode === errorCode);

void describe('StreamETags.from', () => {
  void it('returns a strong entity tag holding the stream name and the version', () => {
    assertEqual(
      '"shopping_cart-123:4"',
      StreamETags.from('shopping_cart-123', 4n),
    );
  });

  void it('accepts a number and a string version', () => {
    assertEqual('"cart-123:4"', StreamETags.from('cart-123', 4));
    assertEqual('"cart-123:4"', StreamETags.from('cart-123', '4'));
  });

  void it('accepts a stream name holding a colon', () => {
    assertEqual('"a:b:7"', StreamETags.from('a:b', 7n));
  });
});

void describe('StreamETags.parse', () => {
  void it('reads the stream name and the version from a strong tag', () => {
    assertDeepEqual(StreamETags.parse('"cart-123:4"'), {
      streamName: 'cart-123',
      version: 4n,
    });
  });

  void it('reads the version from the segment after the last colon', () => {
    assertDeepEqual(StreamETags.parse('"a:b:7"'), {
      streamName: 'a:b',
      version: 7n,
    });
  });

  void it('reads the bare strong form', () => {
    assertDeepEqual(StreamETags.parse('"4"'), { version: 4n });
  });

  void it('reads the weak form', () => {
    assertDeepEqual(StreamETags.parse('W/"4"'), { version: 4n });
  });

  void it('returns undefined for a value that is not a version tag', () => {
    for (const value of [
      '"cart-123:abc"',
      '"2e1f6c58"',
      '*',
      '',
      'cart-123:4',
    ]) {
      assertEqual(undefined, StreamETags.parse(value));
    }
  });
});

void describe('StreamETags.ifMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', () => {
    assertEqual(
      NO_CONCURRENCY_CHECK,
      StreamETags.ifMatch(undefined, streamName) as string,
    );
  });

  void it('throws PreconditionRequiredError when the header is absent and required', () => {
    assertThrowsWithCode(EmmettError.Codes.PreconditionRequiredError, () =>
      StreamETags.ifMatch(undefined, streamName, { required: true }),
    );
  });

  void it('returns STREAM_EXISTS for the wildcard', () => {
    assertEqual(STREAM_EXISTS, StreamETags.ifMatch('*', streamName) as string);
  });

  void it('returns the version when the tag names this stream', () => {
    assertEqual(4n, StreamETags.ifMatch('"cart-123:4"', streamName) as bigint);
  });

  void it('throws ConcurrencyError when the tag names another stream', () => {
    assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
      StreamETags.ifMatch('"cart-123:4"', 'cart-999'),
    );
  });

  void it('accepts the bare strong form', () => {
    assertEqual(4n, StreamETags.ifMatch('"4"', streamName) as bigint);
  });

  void it('accepts the weak form', () => {
    assertEqual(4n, StreamETags.ifMatch('W/"4"', streamName) as bigint);
  });

  void it('returns the first list member that parses and matches', () => {
    assertEqual(3n, StreamETags.ifMatch('"3", "4"', streamName) as bigint);
    assertEqual(
      3n,
      StreamETags.ifMatch('"cart-123:3", "cart-123:4"', streamName) as bigint,
    );
    assertEqual(
      4n,
      StreamETags.ifMatch('"cart-999:3", "cart-123:4"', streamName) as bigint,
    );
  });

  void it('throws ConcurrencyError for a value that is not a version tag', () => {
    for (const headerValue of ['"2e1f6c58"', 'garbage', '']) {
      assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
        StreamETags.ifMatch(headerValue, streamName),
      );
    }
  });

  void it('names the stream on the error it throws', () => {
    assertThrows(
      () => StreamETags.ifMatch('garbage', streamName),
      (error: ConcurrencyError) => error.streamName === streamName,
    );
  });
});

void describe('StreamETags.ifNoneMatch', () => {
  void it('returns NO_CONCURRENCY_CHECK when the header is absent', () => {
    assertEqual(
      NO_CONCURRENCY_CHECK,
      StreamETags.ifNoneMatch(undefined) as string,
    );
  });

  void it('returns STREAM_DOES_NOT_EXIST for the wildcard', () => {
    assertEqual(STREAM_DOES_NOT_EXIST, StreamETags.ifNoneMatch('*') as string);
  });

  void it('throws ConcurrencyError for any list of entity tags', () => {
    for (const headerValue of [
      '"cart-123:4"',
      '"3", "4"',
      'W/"4"',
      'garbage',
    ]) {
      assertThrowsWithCode(EmmettError.Codes.ConcurrencyError, () =>
        StreamETags.ifNoneMatch(headerValue),
      );
    }
  });
});
