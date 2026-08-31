import { describe, it } from 'vitest';
import { EmmettError } from '../errors';
import { assertDeepEqual, assertEqual, assertThrows } from '../testing';
import { ETags, type ETag } from './etag';

const assertThrowsWithCode = (errorCode: number, run: () => unknown) =>
  assertThrows(run, (error: EmmettError) => error.errorCode === errorCode);

void describe('ETags.strong', () => {
  void it('wraps the value in quotation marks', () => {
    assertEqual('"cart-123:4"', ETags.strong('cart-123:4'));
  });

  void it('throws a ValidationError for a value outside etagc', () => {
    for (const value of [
      'cart 123',
      'cart"123',
      'cart\u007F123',
      'cart\n123',
      'cart-\u{1F6D2}',
    ]) {
      assertThrowsWithCode(EmmettError.Codes.ValidationError, () =>
        ETags.strong(value),
      );
    }
  });
});

void describe('ETags.weak', () => {
  void it('prefixes the quoted value with the weakness marker', () => {
    assertEqual('W/"4"', ETags.weak('4'));
  });
});

void describe('ETags.parse', () => {
  void it('reads the opaque value of a strong tag', () => {
    assertDeepEqual(ETags.parse('"cart-123:4"'), {
      value: 'cart-123:4',
      weak: false,
    });
  });

  void it('reads the opaque value of a weak tag', () => {
    assertDeepEqual(ETags.parse('W/"4"'), { value: '4', weak: true });
  });

  void it('returns undefined for a value that is not an entity tag', () => {
    for (const value of ['*', '', 'cart-123:4']) {
      assertEqual(undefined, ETags.parse(value));
    }
  });
});

void describe('ETags.parseList', () => {
  void it('returns the wildcard as itself', () => {
    assertEqual('*', ETags.parseList('*') as string);
  });

  void it('splits a list into its members', () => {
    assertDeepEqual(ETags.parseList('"3", "4"'), ['"3"', '"4"'] as ETag[]);
  });

  void it('returns a single member as a one element list', () => {
    assertDeepEqual(ETags.parseList('"cart-123:4"'), [
      '"cart-123:4"',
    ] as ETag[]);
  });
});
