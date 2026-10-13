import type {
  AnyConnection,
  AnyDatabaseComponent,
  AnyDatabaseTransaction,
  DatabaseDriverType,
  Dumbo,
  SQL,
  SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  noopScope,
  projection,
  type CanHandle,
  type Event,
  type EventStoreReadSchemaOptions,
  type JSONSerializationOptions,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ProjectionHandlerContext,
  type ProjectionInitOptions,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type {
  AnyPostgreSQLEventStoreDriver,
  InferDumboConnectionFromEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  InferTransactionFromEventStoreDriver,
} from '../eventStoreDriver';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import { defaultTag } from '../schema/typing';
import { postgreSQLProjectionLock } from './locks';
import { registerProjection } from './management';

export type PostgreSQLProjectionHandlerContext<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = ProjectionHandlerContext<
  {
    execute: SQLExecutor;
    driverType: DatabaseDriverType;
    driver?: Driver;
  } &
    // TODO: This should be only for Init options
    // Make init options type configurable for projections
    EventStoreSchemaMigrationOptions,
  {
    connection: InferDumboConnectionFromEventStoreDriver<Driver>;
    transaction: InferTransactionFromEventStoreDriver<Driver>;
    pool: InferPoolFromEventStoreDriver<Driver>;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  }
>;

export const transactionToPostgreSQLProjectionHandlerContext = <
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>(
  session: {
    pool: Dumbo;
    driver?: Driver;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  },
  transaction: AnyDatabaseTransaction,
): PostgreSQLProjectionHandlerContext<Driver> =>
  ({
    execute: transaction.execute,
    driverType: session.pool.driverType,
    driver: session.driver,
    session: {
      ...session,
      connection: transaction.connection as AnyConnection,
      transaction: transaction,
    },
    observabilityScope: noopScope,
  }) as PostgreSQLProjectionHandlerContext<Driver>;

export type PostgreSQLProjectionInitContext<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = ProjectionHandlerContext<
  Omit<
    PostgreSQLProjectionHandlerContext<Driver>,
    'session' | 'observabilityScope'
  >,
  Omit<PostgreSQLProjectionHandlerContext<Driver>['session'], 'transaction'>
>;

export const connectionToPostgreSQLProjectionInitContext = <
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>(
  session: {
    pool: Dumbo;
    driver?: Driver;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  },
  connection: AnyConnection,
): PostgreSQLProjectionInitContext<Driver> =>
  ({
    execute: connection.execute,
    driverType: session.pool.driverType,
    driver: session.driver,
    session: {
      ...session,
      connection,
    },
    observabilityScope: noopScope,
  }) as PostgreSQLProjectionInitContext<Driver>;

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext<Driver>
>;

export type PostgreSQLProjectionDefinition<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = ProjectionDefinition<
  EventType,
  PostgresReadEventMetadata,
  PostgreSQLProjectionHandlerContext<Driver>,
  EventPayloadType,
  unknown,
  PostgreSQLProjectionInitContext<Driver>
> & {
  withDefaultSchemaName?: (
    databaseSchemaName: string,
  ) => PostgreSQLProjectionDefinition<EventType, EventPayloadType, Driver>;
};

export type PostgreSQLProjectionHandlerOptions<
  EventType extends Event = Event,
> = {
  events: ReadEvent<EventType, PostgresReadEventMetadata>[];
  projections: PostgreSQLProjectionDefinition<EventType>[];
  partition?: string;
} & PostgreSQLProjectionHandlerContext;

export const handleProjections = async <EventType extends Event = Event>(
  options: PostgreSQLProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    session,
    partition = defaultTag,
  } = options;
  const { transaction } = session;

  for (const projection of allProjections) {
    const filteredEvents = events.filter(({ type }) =>
      projection.canHandle.includes(type),
    );

    if (filteredEvents.length === 0) continue;

    // TODO: Make projection name mandatory
    if (projection.name) {
      const lockAcquired = await postgreSQLProjectionLock({
        databaseSchemaName: options.migrationOptions?.databaseSchemaName,
        projectionName: projection.name,
        partition,
        version: projection.version ?? 1,
      }).tryAcquire({ execute: transaction.execute });

      if (!lockAcquired) {
        continue;
      }
    }

    await projection.handle(filteredEvents, {
      driverType: options.driverType,
      driver: options.driver,
      session,
      execute: transaction.execute,
      migrationOptions: options.migrationOptions,
      observabilityScope: options.observabilityScope,
    });
  }
};

export const postgreSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  definition: PostgreSQLProjectionDefinition<EventType, EventPayloadType>,
): PostgreSQLProjectionDefinition<EventType, EventPayloadType> => {
  const { schema: _schema, ...registeredDefinition } = definition;

  return projection<
    EventType,
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext,
    EventPayloadType,
    unknown,
    PostgreSQLProjectionInitContext
  >({
    ...definition,
    init: async (options) => {
      await registerProjection<
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      >(options.context.execute, {
        databaseSchemaName:
          options.context.migrationOptions?.databaseSchemaName,
        // TODO: pass partition from options
        partition: defaultTag,
        status: 'active',
        registration: {
          type: options.registrationType,
          // TODO: fix this
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          projection: registeredDefinition as any,
        },
      });
      if (definition.init) {
        await definition.init(options);
      }
    },
  });
};

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
    context: ProjectionInitOptions<PostgreSQLProjectionInitContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
  schema?: AnyDatabaseComponent;
} & JSONSerializationOptions;

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
    schema: options.schema,
    withDefaultSchemaName: (databaseSchemaName) =>
      postgreSQLRawBatchSQLProjection({
        ...options,
        schema: options.schema?.withDefaultSchemaName(databaseSchemaName),
      }),
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
    context: ProjectionInitOptions<PostgreSQLProjectionInitContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
  schema?: AnyDatabaseComponent;
} & JSONSerializationOptions;

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
