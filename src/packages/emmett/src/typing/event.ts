import type { DefaultRecord, Flavour } from './';

export type BigIntStreamPosition = bigint;
export type BigIntGlobalPosition = bigint;

export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord = DefaultRecord,
> = Flavour<
  Readonly<{
    type: EventType;
    data: EventData;
    metadata?: EventMetaData;
  }>,
  'Event'
>;

export type EventTypeOf<T extends Event> = T['type'];
export type EventDataOf<T extends Event> = T['data'];
export type EventMetaDataOf<T extends Event> = T['metadata'];

export type CanHandle<T extends Event> = EventTypeOf<T>[];

export type CreateEventType<
  EventType extends string,
  EventData extends DefaultRecord,
  EventMetaData extends DefaultRecord | undefined,
> = Readonly<{
  type: EventType;
  data: EventData;
  metadata?: EventMetaData;
}>;

export const event = <EventType extends Event>(
  type: EventTypeOf<EventType>,
  data: EventDataOf<EventType>,
  metadata?: EventMetaDataOf<EventType>,
): CreateEventType<
  EventTypeOf<EventType>,
  EventDataOf<EventType>,
  EventMetaDataOf<EventType>
> => {
  return {
    type,
    data,
    metadata,
  };
};

export type ReadEvent<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReadEventMetadata<any, any> = EventMetaDataOf<EventType> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReadEventMetadata<any, any>,
> = CreateEventType<
  EventTypeOf<EventType>,
  EventDataOf<EventType>,
  EventMetaDataType
> &
  EventType & { metadata: EventMetaDataType };

export type ReadEventMetadata<
  GlobalPosition = undefined,
  StreamPosition = BigIntStreamPosition,
> = Readonly<{
  eventId: string;
  streamPosition: StreamPosition;
  streamName: string;
}> &
  (GlobalPosition extends undefined
    ? object
    : { globalPosition: GlobalPosition });

export type ReadEventMetadataWithGlobalPosition<
  GlobalPosition = BigIntGlobalPosition,
> = ReadEventMetadata<GlobalPosition>;

export type ReadEventMetadataWithoutGlobalPosition<
  StreamPosition = BigIntStreamPosition,
> = ReadEventMetadata<undefined, StreamPosition>;

export type GlobalPositionTypeOfReadEventMetadata<ReadEventMetadataType> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEventMetadataType extends ReadEventMetadata<infer GP, any> ? GP : never;

export type StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEventMetadataType extends ReadEventMetadata<any, infer SV> ? SV : never;
