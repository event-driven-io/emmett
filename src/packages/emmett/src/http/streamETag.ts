import { ConcurrencyError, PreconditionRequiredError } from '../errors';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type ExpectedStreamVersion,
} from '../eventStore';
import { ETags, type ETag } from './etag';

const from = (streamName: string, version: bigint | number | string): ETag =>
  ETags.strong(`${streamName}:${version}`);

const parse = (
  headerValue: string,
): { streamName?: string; version: bigint } | undefined => {
  const etag = ETags.parse(headerValue);

  if (etag === undefined) return undefined;

  const separatorIndex = etag.value.lastIndexOf(':');
  const streamName =
    separatorIndex === -1 ? undefined : etag.value.slice(0, separatorIndex);
  const version = etag.value.slice(separatorIndex + 1);

  if (!/^\d+$/.test(version)) return undefined;

  return streamName !== undefined
    ? { streamName, version: BigInt(version) }
    : { version: BigInt(version) };
};

const ifMatch = (
  headerValue: string | undefined,
  streamName: string,
  options?: { required?: boolean },
): ExpectedStreamVersion => {
  if (headerValue === undefined) {
    if (options?.required)
      throw new PreconditionRequiredError(
        `The '${streamName}' stream can only be modified by a conditional request; try using "If-Match"`,
      );

    return NO_CONCURRENCY_CHECK;
  }

  const etags = ETags.parseList(headerValue);

  if (etags === '*') return STREAM_EXISTS;

  // The weak form deviates from the strong comparison that RFC 9110 13.1.1 needs. We never emit
  // one, but an old client sends it and a proxy can weaken our tag in flight.
  const matched = etags
    .map(parse)
    .find(
      (etag) =>
        etag !== undefined && (etag.streamName ?? streamName) === streamName,
    );

  // RFC 9110 13.1.1 makes a value that is neither `*` nor a matching entity tag a false condition,
  // and 13.2.2 makes a false `If-Match` a 412, not the 400 a malformed value would otherwise give.
  if (matched === undefined)
    throw new ConcurrencyError(
      undefined,
      headerValue,
      `If-Match value '${headerValue}' is not an entity tag of the '${streamName}' stream`,
      streamName,
    );

  return matched.version;
};

const ifNoneMatch = (
  headerValue: string | undefined,
): ExpectedStreamVersion => {
  if (headerValue === undefined) return NO_CONCURRENCY_CHECK;

  // A list of entity tags means "proceed only if the current version is none of these", and
  // `ExpectedStreamVersion` holds one expected value, so it cannot express that.
  if (ETags.parseList(headerValue) !== '*')
    throw new ConcurrencyError(
      undefined,
      headerValue,
      `If-None-Match value '${headerValue}' cannot be evaluated, as only '*' is supported on a write; retry with If-Match`,
    );

  return STREAM_DOES_NOT_EXIST;
};

export const StreamETags = {
  from,
  parse,
  ifMatch,
  ifNoneMatch,
};
