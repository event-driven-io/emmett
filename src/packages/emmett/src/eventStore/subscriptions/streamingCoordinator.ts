import { v4 as uuid } from 'uuid';
import { notifyAboutNoActiveReadersStream } from '../../streaming/transformations/notifyAboutNoActiveReaders';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import {
  CaughtUpTransformStream,
  streamTrackingGlobalPosition,
} from './caughtUpTransformStream';

export const StreamingCoordinator = () => {
  const allEvents: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[] = [];
  const listeners = new Map<string, CaughtUpTransformStream>();

  return {
    notify: async (
      events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
    ) => {
      if (events.length === 0) return;

      allEvents.push(...events);

      for (const listener of listeners.values()) {
        const writableStream = listener.writable;
        const writer = writableStream.getWriter();

        listener.logPosition =
          events[events.length - 1]!.metadata.globalPosition;

        for (const event of events) {
          await writer.write(event);
        }
      }
    },

    stream: () => {
      const streamId = uuid();
      const transformStream = streamTrackingGlobalPosition(allEvents);

      listeners.set(streamId, transformStream);
      return transformStream.readable.pipeThrough(
        notifyAboutNoActiveReadersStream(
          (stream) => {
            listeners.delete(stream.streamId);
          },
          { streamId },
        ),
      );
    },
  };
};
