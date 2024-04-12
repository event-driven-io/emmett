import type { DefaultRecord, Flavour } from './';

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
