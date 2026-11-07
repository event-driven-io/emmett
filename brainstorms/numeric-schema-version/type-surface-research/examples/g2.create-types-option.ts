import type { DefaultRecord, SchemaVersionProperty } from '@event-driven-io/emmett';
import type { D1, V2 } from './domain';

// Option: CreateEventType gets the same fourth parameter and property as Event
type CreateEventTypeV<
  EventType extends string,
  EventData extends DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number = string extends EventType ? number : 1,
> = Readonly<
  EventMetaData extends undefined
    ? { type: EventType; data: EventData }
    : { type: EventType; data: EventData; metadata: EventMetaData }
> & { readonly kind?: 'Event' } & SchemaVersionProperty<EventType, SchemaVersion>;

type V1c = CreateEventTypeV<'ProductItemAdded', D1>;
export const g6 = (e: V1c | V2) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};
