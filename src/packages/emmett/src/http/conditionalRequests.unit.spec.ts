import { describe, expect, it } from 'vitest';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
} from '../eventStore/expectedVersion';
import {
  ifNoneMatchSatisfied,
  parseStreamVersionPreconditions,
  toStrongETag,
} from './conditionalRequests';

void describe('parseStreamVersionPreconditions', () => {
  void it('maps an exact strong ETag to the stream version', () => {
    expect(parseStreamVersionPreconditions({ ifMatch: '"42"' })).toEqual({
      ok: true,
      expectedStreamVersion: 42n,
    });
  });

  void it('maps If-Match: * to STREAM_EXISTS', () => {
    expect(parseStreamVersionPreconditions({ ifMatch: '*' })).toEqual({
      ok: true,
      expectedStreamVersion: STREAM_EXISTS,
    });
  });

  void it('maps If-None-Match: * to STREAM_DOES_NOT_EXIST', () => {
    expect(parseStreamVersionPreconditions({ ifNoneMatch: '*' })).toEqual({
      ok: true,
      expectedStreamVersion: STREAM_DOES_NOT_EXIST,
    });
  });

  void it('maps missing headers to NO_CONCURRENCY_CHECK', () => {
    expect(parseStreamVersionPreconditions({})).toEqual({
      ok: true,
      expectedStreamVersion: NO_CONCURRENCY_CHECK,
    });
  });

  void it.each([
    ['weak ETag', { ifMatch: 'W/"42"' }],
    ['list of tags', { ifMatch: '"41", "42"' }],
    ['unquoted version', { ifMatch: '42' }],
    ['non-numeric version', { ifMatch: '"abc"' }],
    ['negative version', { ifMatch: '"-1"' }],
    ['leading zeros', { ifMatch: '"042"' }],
    ['If-None-Match with a tag', { ifNoneMatch: '"42"' }],
    ['contradictory headers', { ifMatch: '"42"', ifNoneMatch: '*' }],
  ])('rejects %s', (_, headers) => {
    expect(parseStreamVersionPreconditions(headers).ok).toBe(false);
  });
});

void describe('toStrongETag', () => {
  void it('quotes the stream version', () => {
    expect(toStrongETag(42n)).toBe('"42"');
  });
});

void describe('ifNoneMatchSatisfied', () => {
  void it('matches the current ETag, including in a list', () => {
    expect(ifNoneMatchSatisfied('"41", "42"', '"42"')).toBe(true);
    expect(ifNoneMatchSatisfied('*', '"42"')).toBe(true);
  });

  void it('does not match a different ETag', () => {
    expect(ifNoneMatchSatisfied('"41"', '"42"')).toBe(false);
    expect(ifNoneMatchSatisfied(undefined, '"42"')).toBe(false);
  });
});
