//////////////////////////////////////
/// ETAG
//////////////////////////////////////

export type WeakETag = `W/${string}`;
export type ETag = string;

export const WeakETagRegex = /W\/"(-?\d+.*)"/;

export const enum ETagErrors {
  WRONG_WEAK_ETAG_FORMAT = 'WRONG_WEAK_ETAG_FORMAT',
  MISSING_IF_MATCH_HEADER = 'MISSING_IF_MATCH_HEADER',
}

export const isWeakETag = (etag: ETag): etag is WeakETag => {
  return WeakETagRegex.test(etag);
};

export const getWeakETagValue = (etag: ETag): string => {
  const result = WeakETagRegex.exec(etag);
  if (result === null || result.length === 0) {
    throw ETagErrors.WRONG_WEAK_ETAG_FORMAT;
  }
  return result[1]!;
};

export const toWeakETag = (value: number | bigint | string): WeakETag => {
  return `W/"${value}"`;
};
