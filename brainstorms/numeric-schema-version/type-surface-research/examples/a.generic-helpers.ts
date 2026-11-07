import {
  command,
  event,
  message,
  type Command,
  type DefaultRecord,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type Message,
} from '@event-driven-io/emmett';

// a1: generic over E extends Event, no metadata, no version
export const a1 = <E extends Event>(
  type: EventTypeOf<E>,
  data: EventDataOf<E>,
): E => event<E>(type, data);

// a2: generic over E with declared metadata
export const a2 = <E extends Event<string, DefaultRecord, DefaultRecord>>(
  type: EventTypeOf<E>,
  data: EventDataOf<E>,
  metadata: EventMetaDataOf<E>,
): E => event<E>(type, data, metadata);

// a3: forwarding the helper's own parameters
export const a3 = <E extends Event>(...args: Parameters<typeof event<E>>): E =>
  event<E>(...args);

// a5: generic command
export const a5 = <C extends Command>(type: C['type'], data: C['data']): C =>
  command<C>(type, data);

// a6: generic message
export const a6 = <M extends Message>(
  kind: M['kind'],
  type: M['type'],
  data: M['data'],
): M => message<M>(kind, type, data);
