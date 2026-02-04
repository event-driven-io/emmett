import {
  type DatabaseTransaction,
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
  type EventStoreReadSchemaOptions,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ProjectionInitOptions,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import { defaultTag } from '../schema/typing';
import { postgreSQLProjectionLock } from './locks';
import { registerProjection } from './management';

export type PostgreSQLProjectionHandlerContext = {
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    client: NodePostgresClient;
    transaction: NodePostgresTransaction;
    pool: Dumbo;
  };
} &
  // TODO: This should be only for Init options
  // Make init options type configurable for projections
  EventStoreSchemaMigrationOptions;

export const transactionToPostgreSQLProjectionHandlerContext = async (
  connectionString: string,
  pool: Dumbo,
  transaction:
    | NodePostgresTransaction
    | DatabaseTransaction<'PostgreSQL:pg', unknown>,
): Promise<PostgreSQLProjectionHandlerContext> => ({
  execute: transaction.execute,
  connection: {
    connectionString: connectionString,
    client: (await transaction.connection.open()) as NodePostgresClient,
    transaction,
    pool,
  },
});

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext
>;

export type PostgreSQLProjectionDefinition<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
> = ProjectionDefinition<
  EventType,
  PostgresReadEventMetadata,
  PostgreSQLProjectionHandlerContext,
  EventPayloadType
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
  partition?: string;
};

export const handleProjections = async <EventType extends Event = Event>(
  options: PostgreSQLProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    connection: { pool, transaction, connectionString },
    partition = defaultTag,
  } = options;

  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  const client = (await transaction.connection.open()) as NodePostgresClient;

  for (const projection of projections) {
    // TODO: Make projection name mandatory
    if (projection.name) {
      const lockAcquired = await postgreSQLProjectionLock({
        projectionName: projection.name,
        partition,
        version: projection.version ?? 1,
      }).tryAcquire({ execute: transaction.execute });

      if (!lockAcquired) {
        continue;
      }
    }

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

export const postgreSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  definition: PostgreSQLProjectionDefinition<EventType, EventPayloadType>,
): PostgreSQLProjectionDefinition<EventType, EventPayloadType> =>
  projection<
    EventType,
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext,
    EventPayloadType
  >({
    ...definition,
    init: async (options) => {
      await registerProjection<
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      >(options.context.execute, {
        // TODO: pass partition from options
        partition: defaultTag,
        status: 'active',
        registration: {
          type: 'async',
          // TODO: fix this
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          projection: definition as any,
        },
      });
      if (definition.init) {
        await definition.init(options);
      }
    },
  });

export type PostgreSQLRawBatchSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType[],
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[];
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<PostgreSQLProjectionHandlerContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
};

export const postgreSQLRawBatchSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options: PostgreSQLRawBatchSQLProjection<EventType, EventPayloadType>,
): PostgreSQLProjectionDefinition<EventType, EventPayloadType> =>
  postgreSQLProjection<EventType, EventPayloadType>({
    name: options.name,
    kind: options.kind ?? 'emt:projections:postgresql:raw_sql:batch',
    version: options.version,
    canHandle: options.canHandle,
    eventsOptions: options.eventsOptions,
    handle: async (events, context) => {
      const sqls: SQL[] = await options.evolve(events, context);

      await context.execute.batchCommand(sqls);
    },
    init: async (initOptions) => {
      const initSQL = options.init
        ? await options.init(initOptions)
        : undefined;

      if (initSQL) {
        if (Array.isArray(initSQL)) {
          await initOptions.context.execute.batchCommand(initSQL);
        } else {
          await initOptions.context.execute.command(initSQL);
        }
      }
    },
  });

export type PostgreSQLRawSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType,
    context: PostgreSQLProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[] | Promise<SQL> | SQL;
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<PostgreSQLProjectionHandlerContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
};

export const postgreSQLRawSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options: PostgreSQLRawSQLProjection<EventType, EventPayloadType>,
): PostgreSQLProjectionDefinition<EventType, EventPayloadType> => {
  const { evolve, kind, ...rest } = options;
  return postgreSQLRawBatchSQLProjection<EventType, EventPayloadType>({
    kind: kind ?? 'emt:projections:postgresql:raw:_sql:single',
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
