import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type ExpectedStreamVersion,
} from '../eventStore/expectedVersion';
import type { StreamPosition } from '../typing';

export type StrongETag = `"${string}"`;

export const toStrongETag = (value: StreamPosition | string): StrongETag =>
  `"${value.toString()}"`;

export type StreamVersionPreconditions = {
  ifMatch?: string | null | undefined;
  ifNoneMatch?: string | null | undefined;
};

export type StreamVersionPreconditionsResult =
  | { ok: true; expectedStreamVersion: ExpectedStreamVersion }
  | { ok: false; reason: string };

const strongStreamVersionETag = /^"(0|[1-9]\d*)"$/;

/**
 * Maps HTTP conditional request headers to Emmett's expected stream version.
 *
 * | Expectation             | Header             |
 * | ----------------------- | ------------------ |
 * | exact version `42`      | `If-Match: "42"`   |
 * | `STREAM_EXISTS`         | `If-Match: *`      |
 * | `STREAM_DOES_NOT_EXIST` | `If-None-Match: *` |
 * | `NO_CONCURRENCY_CHECK`  | no header          |
 *
 * Weak ETags, lists of tags, contradictory headers and malformed versions are rejected.
 */
export const parseStreamVersionPreconditions = ({
  ifMatch,
  ifNoneMatch,
}: StreamVersionPreconditions): StreamVersionPreconditionsResult => {
  const match = ifMatch?.trim();
  const noneMatch = ifNoneMatch?.trim();
  const hasMatch = match !== undefined && match !== null && match !== '';
  const hasNoneMatch =
    noneMatch !== undefined && noneMatch !== null && noneMatch !== '';

  if (hasMatch && hasNoneMatch)
    return {
      ok: false,
      reason: 'If-Match and If-None-Match cannot be used together.',
    };

  if (hasNoneMatch) {
    return noneMatch === '*'
      ? { ok: true, expectedStreamVersion: STREAM_DOES_NOT_EXIST }
      : {
          ok: false,
          reason: 'If-None-Match supports only "*" when appending messages.',
        };
  }

  if (!hasMatch)
    return { ok: true, expectedStreamVersion: NO_CONCURRENCY_CHECK };

  if (match === '*') return { ok: true, expectedStreamVersion: STREAM_EXISTS };

  const version = parseStrongStreamVersionETag(match);

  return version !== undefined
    ? { ok: true, expectedStreamVersion: version }
    : {
        ok: false,
        reason:
          'If-Match must be "*" or a single strong ETag containing a stream version, e.g. "42".',
      };
};

export const parseStrongStreamVersionETag = (
  etag: string,
): StreamPosition | undefined => {
  const result = strongStreamVersionETag.exec(etag.trim());

  return result ? BigInt(result[1]!) : undefined;
};

/**
 * Checks `If-None-Match` for conditional GET requests.
 * Returns `true` when the current ETag matches one of the listed tags or `*`.
 */
export const ifNoneMatchSatisfied = (
  ifNoneMatch: string | null | undefined,
  currentETag: string,
): boolean => {
  if (!ifNoneMatch) return false;

  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim())
    .some(
      (tag) => tag === '*' || tag === currentETag || tag === `W/${currentETag}`,
    );
};
