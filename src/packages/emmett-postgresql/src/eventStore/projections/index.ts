import {
  type NodePostgresClient,
  type NodePostgresTransaction,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  type Event,
  type EventTypeOf,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';

export type ProjectionHandlerContext = {
  connectionString: string;
  client: NodePostgresClient;
  execute: SQLExecutor;
  transaction: NodePostgresTransaction;
};

export type PostgresProjectionHandler<EventType extends Event = Event> = (
  events: ReadEvent<EventType>[],
  context: ProjectionHandlerContext,
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
  transaction: NodePostgresTransaction,
  events: ReadEvent<EventType>[],
): Promise<void> => {
  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  const client = (await transaction.connection.open()) as NodePostgresClient;

  for (const projection of projections) {
    await projection.handle(events, {
      connectionString,
      client,
      transaction,
      execute: transaction.execute,
    });
  }
};

export const projection = <EventType extends Event>(
  definition: ProjectionDefintion<EventType>,
): ProjectionDefintion => definition as unknown as ProjectionDefintion;

export const inlineProjection = <EventType extends Event>(
  definition: Omit<ProjectionDefintion<EventType>, 'type'>,
): ProjectionDefintion => projection({ type: 'inline', ...definition });

export * from './pongo';
