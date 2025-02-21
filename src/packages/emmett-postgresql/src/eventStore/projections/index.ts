import {
  type NodePostgresClient,
  type NodePostgresTransaction,
  type SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  projection,
  type CanHandle,
  type Event,
  type ProjectionHandler,
  type ReadEvent,
  type TypedProjectionDefinition,
} from '@event-driven-io/emmett';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';

export type PostgreSQLProjectionHandlerContext = {
  connectionString: string;
  client: NodePostgresClient;
  execute: SQLExecutor;
  transaction: NodePostgresTransaction;
};

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext
>;

export type PostgreSQLProjectionDefinition<EventType extends Event = Event> =
  TypedProjectionDefinition<
    EventType,
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext
  >;

export type PostgreSQLProjectionHandlerOptions<
  EventType extends Event = Event,
> = {
  events: ReadEvent<EventType, PostgresReadEventMetadata>[];
  projections: PostgreSQLProjectionDefinition<EventType>[];
  connection: {
    connectionString: string;
    transaction: NodePostgresTransaction;
  };
};

export const handleProjections = async <EventType extends Event = Event>(
  options: PostgreSQLProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    connection: { transaction, connectionString },
  } = options;

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

export const postgreSQLProjection = <EventType extends Event>(
  definition: PostgreSQLProjectionDefinition<EventType>,
): PostgreSQLProjectionDefinition =>
  projection<
    EventType,
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext,
    PostgreSQLProjectionDefinition<EventType>
  >(definition) as PostgreSQLProjectionDefinition;

export const postgreSQLRawBatchSQLProjection = <EventType extends Event>(
  handle: (
    events: EventType[],
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[],
  ...canHandle: CanHandle<EventType>
): PostgreSQLProjectionDefinition =>
  postgreSQLProjection<EventType>({
    canHandle,
    handle: async (events, context) => {
      const sqls: SQL[] = await handle(events, context);

      await context.execute.batchCommand(sqls);
    },
  });

export const postgreSQLRawSQLProjection = <EventType extends Event>(
  handle: (
    event: EventType,
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL> | SQL,
  ...canHandle: CanHandle<EventType>
): PostgreSQLProjectionDefinition =>
  postgreSQLRawBatchSQLProjection<EventType>(
    async (events, context) => {
      const sqls: SQL[] = [];

      for (const event of events) {
        sqls.push(await handle(event, context));
      }
      return sqls;
    },
    ...canHandle,
  );

export * from './pongo';
export * from './postgresProjectionSpec';
