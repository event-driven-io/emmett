export type StreamIdentity = { streamType: string; streamId: string };

/**
 * Optional parser/formatter of structured stream names.
 * Failing to parse means "unstructured", never "invalid".
 */
export type StreamIdentityCodec = {
  parse: (streamName: string) => StreamIdentity | undefined;
  format: (identity: StreamIdentity) => string;
};

/**
 * Emmett's `type:id` convention, e.g. `order:order-123`.
 * The type is everything before the first colon.
 */
export const typeIdStreamIdentityCodec: StreamIdentityCodec = {
  parse: (streamName) => {
    const separator = streamName.indexOf(':');
    if (separator <= 0 || separator === streamName.length - 1) return undefined;

    return {
      streamType: streamName.slice(0, separator),
      streamId: streamName.slice(separator + 1),
    };
  },
  format: ({ streamType, streamId }) => `${streamType}:${streamId}`,
};
