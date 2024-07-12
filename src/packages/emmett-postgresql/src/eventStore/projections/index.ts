import {
  type Event,
  type EventTypeOf,
  type ReadEvent
} from '@event-driven-io/emmett';
import pg from 'pg';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';

export type PostgresProjectionHandler<EventType extends Event = Event> = (
  connectionString: string,
  client: pg.PoolClient,
  events: ReadEvent<EventType>[],
) => Promise<void> | void;

export type ProjectionDefintion<EventType extends Event = Event> = {
  type: 'inline';
  name?: string;
  canHandle: EventTypeOf<EventType>[];
  handle: PostgresProjectionHandler<EventType>;
};

export const defaultProjectionOptions: PostgresEventStoreOptions = {
  projections: [],
};

export const handleProjections = async <EventType extends Event = Event>(
  allProjections: ProjectionDefintion<EventType>[],
  connectionString: string,
  client: pg.PoolClient,
  events: ReadEvent<EventType>[],
): Promise<void> => {
  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  for (const projection of projections) {
    await projection.handle(connectionString, client, events);
  }
};
