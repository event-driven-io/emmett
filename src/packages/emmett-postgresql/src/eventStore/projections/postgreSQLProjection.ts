import {
  type Dumbo,
  type NodePostgresClient,
  type NodePostgresTransaction,
  type SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  projection,
  type CanHandle,
  type Event,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';

export type PostgreSQLProjectionHandlerContext = {
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    client: NodePostgresClient;
    transaction: NodePostgresTransaction;
    pool: Dumbo;
  };
};

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext
>;

export type PostgreSQLProjectionDefinition<EventType extends Event = Event> =
  ProjectionDefinition<
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
    pool: Dumbo;
  };
};

export const handleProjections = async <EventType extends Event = Event>(
  options: PostgreSQLProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    connection: { pool, transaction, connectionString },
  } = options;

  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  const client = (await transaction.connection.open()) as NodePostgresClient;

  for (const projection of projections) {
    await projection.handle(events, {
      connection: {
        connectionString,
        pool,
        client,
        transaction,
      },
      execute: transaction.execute,
    });
  }
};

export const postgreSQLProjection = <EventType extends Event>(
  definition: PostgreSQLProjectionDefinition<EventType>,
): PostgreSQLProjectionDefinition<EventType> =>
  projection<
    EventType,
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext
  >(definition);

export type PostgreSQLRawBatchSQLProjection<EventType extends Event> = {
  evolve: (
    events: EventType[],
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[];
  canHandle: CanHandle<EventType>;
  initSQL?: SQL | SQL[];
  init?: (context: PostgreSQLProjectionHandlerContext) => void | Promise<void>;
};

export const postgreSQLRawBatchSQLProjection = <EventType extends Event>(
  options: PostgreSQLRawBatchSQLProjection<EventType>,
): PostgreSQLProjectionDefinition<EventType> =>
  postgreSQLProjection<EventType>({
    canHandle: options.canHandle,
    handle: async (events, context) => {
      const sqls: SQL[] = await options.evolve(events, context);

      await context.execute.batchCommand(sqls);
    },
    init: async (context) => {
      if (options.init) {
        await options.init(context);
      }
      if (options.initSQL) {
        if (Array.isArray(options.initSQL)) {
          await context.execute.batchCommand(options.initSQL);
        } else {
          await context.execute.command(options.initSQL);
        }
      }
    },
  });

export type PostgreSQLRawSQLProjection<EventType extends Event> = {
  evolve: (
    events: EventType,
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[] | Promise<SQL> | SQL;
  canHandle: CanHandle<EventType>;
  initSQL?: SQL | SQL[];
  init?: (context: PostgreSQLProjectionHandlerContext) => void | Promise<void>;
};

export const postgreSQLRawSQLProjection = <EventType extends Event>(
  options: PostgreSQLRawSQLProjection<EventType>,
): PostgreSQLProjectionDefinition<EventType> => {
  const { evolve, ...rest } = options;
  return postgreSQLRawBatchSQLProjection<EventType>({
    ...rest,
    evolve: async (events, context) => {
      const sqls: SQL[] = [];

      for (const event of events) {
        const pendingSqls = await evolve(event, context);
        if (Array.isArray(pendingSqls)) {
          sqls.push(...pendingSqls);
        } else {
          sqls.push(pendingSqls);
        }
      }
      return sqls;
    },
  });
};
