import { EmmettError, ValidationError } from '../errors';
import type { Brand } from '../typing';

export type WeakETag = Brand<`W/${string}`, 'ETag'>;
export type ETag = Brand<string, 'ETag'>;

export const enum ETagErrors {
  WRONG_WEAK_ETAG_FORMAT = 'WRONG_WEAK_ETAG_FORMAT',
  MISSING_IF_MATCH_HEADER = 'MISSING_IF_MATCH_HEADER',
  MISSING_IF_NOT_MATCH_HEADER = 'MISSING_IF_NOT_MATCH_HEADER',
  MISSING_IF_NONE_MATCH_HEADER = 'MISSING_IF_NONE_MATCH_HEADER',
}

/**
 * @deprecated Emmett emits strong entity tags. Use {@link ETags.parse} to read one.
 */
export const WeakETagRegex = /W\/"(-?\d+.*)"/;

/**
 * @deprecated Emmett emits strong entity tags. Use {@link ETags.parse} to read one.
 */
export const isWeakETag = (etag: ETag): etag is WeakETag => {
  return WeakETagRegex.test(etag);
};

/**
 * @deprecated Emmett emits strong entity tags. Use {@link ETags.parse} to read one.
 */
export const getWeakETagValue = (etag: ETag): string => {
  const result = WeakETagRegex.exec(etag);
  if (result === null || result.length === 0) {
    throw new EmmettError({
      errorCode: EmmettError.Codes.ConcurrencyError,
      message: ETagErrors.WRONG_WEAK_ETAG_FORMAT,
    });
  }
  return result[1]!;
};

/**
 * @deprecated Use {@link ETags.strong}, as `If-Match` needs a strong entity tag.
 */
export const toWeakETag = (value: number | bigint | string): WeakETag => {
  return `W/"${value}"` as WeakETag;
};

const ETagCharsRegex = /^[\u0021\u0023-\u007E\u0080-\u00FF]*$/;

const OpaqueTagRegex = /^"(.*)"$/;

const assertETagChars = (value: string): void => {
  if (!ETagCharsRegex.test(value))
    throw new ValidationError(
      `Value '${value}' cannot be used in an ETag, as it holds a character that RFC 9110 8.8.3 does not allow`,
    );
};

const strong = (value: string): ETag => {
  assertETagChars(value);

  return `"${value}"` as ETag;
};

const weak = (value: string): WeakETag => {
  assertETagChars(value);

  return `W/"${value}"` as WeakETag;
};

const parse = (
  headerValue: string,
): { value: string; weak: boolean } | undefined => {
  const isWeak = headerValue.startsWith('W/');
  const opaqueTag = isWeak ? headerValue.slice(2) : headerValue;

  const quoted = OpaqueTagRegex.exec(opaqueTag);

  return quoted === null ? undefined : { value: quoted[1]!, weak: isWeak };
};

const parseList = (headerValue: string): '*' | ETag[] => {
  const value = headerValue.trim();

  return value === '*'
    ? '*'
    : value.split(',').map((member) => member.trim() as ETag);
};

export const ETags = {
  strong,
  weak,
  parse,
  parseList,
};
