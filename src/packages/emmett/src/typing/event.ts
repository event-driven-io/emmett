import type { DefaultRecord, Flavour } from './';

export type BigIntStreamPosition = bigint;
export type BigIntGlobalPosition = bigint;

export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
> = Flavour<
  Readonly<
    EventMetaData extends undefined
      ? {
          type: EventType;
          data: EventData;
        }
      : {
          type: EventType;
          data: EventData;
          metadata: EventMetaData;
        }
  >,
  'Event'
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEvent = Event<any, any, any>;

export type EventTypeOf<T extends Event> = T['type'];
export type EventDataOf<T extends Event> = T['data'];
export type EventMetaDataOf<T extends Event> = T extends { metadata: infer M }
  ? M
  : undefined;

export type CanHandle<T extends Event> = EventTypeOf<T>[];

export type CreateEventType<
  EventType extends string,
  EventData extends DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
> = Readonly<
  EventMetaData extends undefined
    ? {
        type: EventType;
        data: EventData;
      }
    : {
        type: EventType;
        data: EventData;
        metadata: EventMetaData;
      }
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const event = <EventType extends Event<string, any, any>>(
  ...args: EventMetaDataOf<EventType> extends undefined
    ? [type: EventTypeOf<EventType>, data: EventDataOf<EventType>]
    : [
        type: EventTypeOf<EventType>,
        data: EventDataOf<EventType>,
        metadata: EventMetaDataOf<EventType>,
      ]
): EventType => {
  const [type, data, metadata] = args;

  return metadata !== undefined
    ? ({ type, data, metadata } as EventType)
    : ({ type, data } as EventType);
};

export type CombinedReadEventMetadata<
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> =
  EventMetaDataOf<EventType> extends undefined
    ? EventMetaDataType
    : EventMetaDataOf<EventType> & EventMetaDataType;

export type ReadEvent<
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = EventType & {
  metadata: CombinedReadEventMetadata<EventType, EventMetaDataType>;
};

export type CommonReadEventMetadata<StreamPosition = BigIntStreamPosition> =
  Readonly<{
    eventId: string;
    streamPosition: StreamPosition;
    streamName: string;
  }>;

export type WithGlobalPosition<GlobalPosition> = Readonly<{
  globalPosition: GlobalPosition;
}>;

export type ReadEventMetadata<
  GlobalPosition = undefined,
  StreamPosition = BigIntStreamPosition,
> = CommonReadEventMetadata<StreamPosition> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  (GlobalPosition extends undefined ? {} : WithGlobalPosition<GlobalPosition>);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReadEventMetadata = ReadEventMetadata<any, any>;

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
