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
  type EventMetaDataOf,
  type ProjectionHandler,
  type ReadEvent,
  type ReadEventMetadata,
  type TypedProjectionDefinition,
} from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';

export type PostgreSQLProjectionHandlerContext = {
  connectionString: string;
  client: NodePostgresClient;
  execute: SQLExecutor;
  transaction: NodePostgresTransaction;
};

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext
>;

export type PostgreSQLProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
> = TypedProjectionDefinition<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext
>;

export const defaultPostgreSQLProjectionOptions: PostgresEventStoreOptions = {
  projections: [],
};

export type ProjectionHandlerOptions<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
> = {
  events: ReadEvent<EventType, EventMetaDataType>[];
  projections: PostgreSQLProjectionDefinition<EventType>[];
  connection: {
    connectionString: string;
    transaction: NodePostgresTransaction;
  };
};

export const handleProjections = async <
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
>(
  options: ProjectionHandlerOptions<EventType, EventMetaDataType>,
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

export const postgreSQLProjection = <
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
>(
  definition: PostgreSQLProjectionDefinition<EventType>,
): PostgreSQLProjectionDefinition =>
  projection<
    EventType,
    EventMetaDataType,
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
