import {
  ETags,
  StreamETags,
  EmmettError,
  ETagErrors,
  getWeakETagValue,
  HeaderNames,
  isWeakETag,
  PreconditionRequiredError,
  toWeakETag,
  WeakETagRegex,
  type ETag,
  type ExpectedStreamVersion,
  type WeakETag,
} from '@event-driven-io/emmett';
import type { Context } from 'hono';

export {
  ETagErrors,
  ETags,
  StreamETags,
  getWeakETagValue,
  HeaderNames,
  isWeakETag,
  PreconditionRequiredError,
  toWeakETag,
  WeakETagRegex,
  type ETag,
  type WeakETag,
};

/**
 * @deprecated Use {@link getExpectedStreamVersionFromIfMatch} instead. It returns an
 * `ExpectedStreamVersion` and never a raw header value.
 */
export const getETagFromIfMatch = (context: Context): ETag => {
  const etag = context.req.header(HeaderNames.IF_MATCH);

  if (etag === undefined) {
    throw new EmmettError({
      errorCode: EmmettError.Codes.ConcurrencyError,
      message: ETagErrors.MISSING_IF_MATCH_HEADER,
    });
  }

  return etag as ETag;
};

export const getETagFromIfNoneMatch = (context: Context): ETag => {
  const etag = context.req.header(HeaderNames.IF_NONE_MATCH);

  if (etag === undefined) {
    throw new EmmettError({
      errorCode: EmmettError.Codes.ConcurrencyError,
      message: ETagErrors.MISSING_IF_NONE_MATCH_HEADER,
    });
  }

  return etag as ETag;
};

/**
 * @deprecated Use {@link getETagFromIfNoneMatch} instead. There is no `If-Not-Match` header.
 */
export const getETagFromIfNotMatch = getETagFromIfNoneMatch;

export const getExpectedStreamVersionFromIfMatch = (
  context: Context,
  streamName: string,
  options?: { required?: boolean },
): ExpectedStreamVersion =>
  StreamETags.ifMatch(
    context.req.header(HeaderNames.IF_MATCH),
    streamName,
    options,
  );

export const getExpectedStreamVersionFromIfNoneMatch = (
  context: Context,
): ExpectedStreamVersion =>
  StreamETags.ifNoneMatch(context.req.header(HeaderNames.IF_NONE_MATCH));

export const setETag = (context: Context, etag: ETag): void => {
  context.header(HeaderNames.ETag, etag);
};

/**
 * @deprecated Use {@link getExpectedStreamVersionFromIfMatch} instead. This returns the raw header
 * value for a strong entity tag, so the quotation marks reach the caller.
 */
export const getETagValueFromIfMatch = (context: Context): string => {
  const eTagValue: ETag = getETagFromIfMatch(context);

  return isWeakETag(eTagValue) ? getWeakETagValue(eTagValue) : eTagValue;
};
