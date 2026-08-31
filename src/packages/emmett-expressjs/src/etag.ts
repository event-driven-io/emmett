import {
  StreamETags,
  EmmettError,
  ETagErrors,
  HeaderNames,
  isWeakETag,
  getWeakETagValue,
  type ETag,
  type ExpectedStreamVersion,
} from '@event-driven-io/emmett';
import type { Request, Response } from 'express';

export {
  ETagErrors,
  ETags,
  StreamETags,
  HeaderNames,
  WeakETagRegex,
  getWeakETagValue,
  isWeakETag,
  PreconditionRequiredError,
  toWeakETag,
} from '@event-driven-io/emmett';
export type { ETag, WeakETag } from '@event-driven-io/emmett';

const getHeader = (request: Request, name: string): string | undefined => {
  const value = request.headers[name];

  return Array.isArray(value) ? value.join(', ') : value;
};

/**
 * @deprecated Use {@link getExpectedStreamVersionFromIfMatch} instead. It returns an
 * `ExpectedStreamVersion` and never hands the raw header to the event store.
 */
export const getETagFromIfMatch = (request: Request): ETag => {
  const etag = getHeader(request, HeaderNames.IF_MATCH);

  if (etag === undefined) {
    throw new EmmettError({
      errorCode: EmmettError.Codes.ConcurrencyError,
      message: ETagErrors.MISSING_IF_MATCH_HEADER,
    });
  }

  return etag as ETag;
};

export const getETagFromIfNoneMatch = (request: Request): ETag => {
  const etag = getHeader(request, HeaderNames.IF_NONE_MATCH);

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
export const getETagFromIfNotMatch = (request: Request): ETag =>
  getETagFromIfNoneMatch(request);

export const getExpectedStreamVersionFromIfMatch = (
  request: Request,
  streamName: string,
  options?: { required?: boolean },
): ExpectedStreamVersion =>
  StreamETags.ifMatch(
    getHeader(request, HeaderNames.IF_MATCH),
    streamName,
    options,
  );

export const getExpectedStreamVersionFromIfNoneMatch = (
  request: Request,
): ExpectedStreamVersion =>
  StreamETags.ifNoneMatch(getHeader(request, HeaderNames.IF_NONE_MATCH));

export const setETag = (response: Response, etag: ETag): void => {
  response.setHeader(HeaderNames.ETag, etag);
};

/**
 * @deprecated Use {@link getExpectedStreamVersionFromIfMatch} instead. This returns the raw header
 * for a strong entity tag, so `"4"` reaches `BigInt` and fails as a server error.
 */
export const getETagValueFromIfMatch = (request: Request): string => {
  const eTagValue: ETag = getETagFromIfMatch(request);

  return isWeakETag(eTagValue) ? getWeakETagValue(eTagValue) : eTagValue;
};
