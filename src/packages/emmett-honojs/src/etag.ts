import { type Brand } from '@event-driven-io/emmett';
import type { Context } from 'hono';

//////////////////////////////////////
/// ETAG
//////////////////////////////////////

export const HeaderNames = {
  IF_MATCH: 'if-match',
  IF_NOT_MATCH: 'if-not-match',
  ETag: 'etag',
};

export type WeakETag = Brand<`W/${string}`, 'ETag'>;
export type ETag = Brand<string, 'ETag'>;

export const WeakETagRegex = /W\/"(-?\d+.*)"/;

export const enum ETagErrors {
  WRONG_WEAK_ETAG_FORMAT = 'WRONG_WEAK_ETAG_FORMAT',
  MISSING_IF_MATCH_HEADER = 'MISSING_IF_MATCH_HEADER',
  MISSING_IF_NOT_MATCH_HEADER = 'MISSING_IF_NOT_MATCH_HEADER',
}

export const isWeakETag = (etag: ETag): etag is WeakETag => {
  return WeakETagRegex.test(etag as string);
};

export const getWeakETagValue = (etag: ETag): string => {
  const result = WeakETagRegex.exec(etag as string);
  if (result === null || result.length === 0) {
    throw new Error(ETagErrors.WRONG_WEAK_ETAG_FORMAT);
  }
  return result[1]!;
};

export const toWeakETag = (value: number | bigint | string): WeakETag => {
  return `W/"${value}"` as WeakETag;
};

export const getETagFromIfMatch = (context: Context): ETag => {
  const etag = context.req.header(HeaderNames.IF_MATCH);

  if (etag === undefined) {
    throw new Error(ETagErrors.MISSING_IF_MATCH_HEADER);
  }

  return etag as ETag;
};

export const getETagFromIfNotMatch = (context: Context): ETag => {
  const etag = context.req.header(HeaderNames.IF_NOT_MATCH);

  if (etag === undefined) {
    throw new Error(ETagErrors.MISSING_IF_MATCH_HEADER);
  }

  return (Array.isArray(etag) ? etag[0] : etag) as ETag;
};

export const setETag = (context: Context, etag: ETag): void => {
  context.header(HeaderNames.ETag, etag);
};

export const getETagValueFromIfMatch = (context: Context): string => {
  const eTagValue: ETag = getETagFromIfMatch(context);

  return isWeakETag(eTagValue)
    ? getWeakETagValue(eTagValue)
    : (eTagValue as string);
};
