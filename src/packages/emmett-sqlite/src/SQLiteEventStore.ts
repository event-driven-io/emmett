import type {
  BigIntStreamPosition,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';

import {
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const SQLiteEventStoreDefaultStreamVersion = 0n;

export type SQLiteEventStore = EventStore<ReadEventMetadataWithGlobalPosition>;

export const getSQLiteEventStore = (): SQLiteEventStore => {
  return {
    aggregateStream<State, EventType extends Event>(
      _streamName: string,
      _options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition
      >,
    ): Promise<AggregateStreamResult<State>> {
      throw new Error('Not implemented');
    },

    readStream: <EventType extends Event>(
      _streamName: string,
      _options?: ReadStreamOptions<BigIntStreamPosition>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > => {
      throw new Error('Not implemented');
    },

    appendToStream: <EventType extends Event>(
      _streamName: string,
      _events: EventType[],
      _options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      throw new Error('Not implemented');
    },
  };
};
