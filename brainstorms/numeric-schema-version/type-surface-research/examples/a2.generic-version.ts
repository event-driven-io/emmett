import { event, type Event, type MessageSchemaVersionOf } from '@event-driven-io/emmett';

// a4: generic over the version literal
export const a4 = <V extends number>(v: V) =>
  event<Event<'X', { a: 1 }, undefined, V>>('X', { a: 1 }, v);

// a7: generic constrained to a versioned shape
export const a7 = <E extends Event<'X', { a: 1 }, undefined, 2>>(): E =>
  event<E>('X', { a: 1 }, 2);

// a8: generic forwarding the version through MessageSchemaVersionOf
export const a8 = <E extends Event<'X', { a: 1 }, undefined, 2>>(
  v: MessageSchemaVersionOf<E>,
): E => event<E>('X', { a: 1 }, v);
