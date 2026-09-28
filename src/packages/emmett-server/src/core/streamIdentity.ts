import { fromStreamName, type StreamName } from '@event-driven-io/emmett';

export type StreamIdentity = { streamType: string; streamId: string };

/**
 * Optional parser of structured stream names.
 * Failing to parse means "unstructured", never "invalid".
 */
export type StreamIdentityCodec = {
  parse: (streamName: string) => StreamIdentity | undefined;
};

/**
 * Emmett's `type:id` convention, parsed with `fromStreamName`.
 */
export const typeIdStreamIdentityCodec: StreamIdentityCodec = {
  parse: (streamName) => {
    const { streamType, streamId } = fromStreamName(streamName as StreamName);

    return streamType && streamId ? { streamType, streamId } : undefined;
  },
};
