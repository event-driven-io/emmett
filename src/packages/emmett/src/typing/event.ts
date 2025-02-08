import type { DefaultRecord } from './';
import type {
  AnyRecordedMessageMetadata,
  CombinedRecordedMessageMetadata,
  CommonRecordedMessageMetadata,
  GlobalPositionTypeOfRecordedMessageMetadata,
  RecordedMessage,
  RecordedMessageMetadata,
  RecordedMessageMetadataWithGlobalPosition,
  RecordedMessageMetadataWithoutGlobalPosition,
  StreamPositionTypeOfRecordedMessageMetadata,
} from './message';

export type BigIntStreamPosition = bigint;
export type BigIntGlobalPosition = bigint;

export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
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
> & { readonly kind?: 'Event' };

export type EventTypeOf<T extends Event> = T['type'];
export type EventDataOf<T extends Event> = T['data'];
export type EventMetaDataOf<T extends Event> = T extends { metadata: infer M }
  ? M
  : undefined;

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
> & { readonly kind?: 'Event' };

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
    ? ({ type, data, metadata, kind: 'Event' } as EventType)
    : ({ type, data, kind: 'Event' } as EventType);
};

export type CombinedReadEventMetadata<
  EventType extends Event = Event,
  EventMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = CombinedRecordedMessageMetadata<EventType, EventMetaDataType>;

export type ReadEvent<
  EventType extends Event = Event,
  EventMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = RecordedMessage<EventType, EventMetaDataType>;

export type CommonReadEventMetadata<StreamPosition = BigIntStreamPosition> =
  CommonRecordedMessageMetadata<StreamPosition>;

export type ReadEventMetadata<
  GlobalPosition = undefined,
  StreamPosition = BigIntStreamPosition,
> = RecordedMessageMetadata<GlobalPosition, StreamPosition>;

export type AnyReadEventMetadata = AnyRecordedMessageMetadata;

export type ReadEventMetadataWithGlobalPosition<
  GlobalPosition = BigIntGlobalPosition,
> = RecordedMessageMetadataWithGlobalPosition<GlobalPosition>;

export type ReadEventMetadataWithoutGlobalPosition<
  StreamPosition = BigIntStreamPosition,
> = RecordedMessageMetadataWithoutGlobalPosition<StreamPosition>;

export type GlobalPositionTypeOfReadEventMetadata<ReadEventMetadataType> =
  GlobalPositionTypeOfRecordedMessageMetadata<ReadEventMetadataType>;

export type StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType> =
  StreamPositionTypeOfRecordedMessageMetadata<ReadEventMetadataType>;
