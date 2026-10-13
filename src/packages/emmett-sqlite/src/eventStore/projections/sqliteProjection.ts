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
  AnySQLiteEventStoreDriver,
  InferDumboConnectionFromEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  InferTransactionFromEventStoreDriver,
} from '../eventStoreDriver';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import type { SQLiteReadEventMetadata } from '../SQLiteEventStore';

export type SQLiteProjectionHandlerContext<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
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

export const transactionToSQLiteProjectionHandlerContext = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  session: {
    pool: Dumbo;
    driver?: Driver;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  },
  transaction: AnyDatabaseTransaction,
): SQLiteProjectionHandlerContext<Driver> =>
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
  }) as SQLiteProjectionHandlerContext<Driver>;

export type SQLiteProjectionInitContext<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = ProjectionHandlerContext<
  Omit<
    SQLiteProjectionHandlerContext<Driver>,
    'session' | 'observabilityScope'
  >,
  Omit<SQLiteProjectionHandlerContext<Driver>['session'], 'transaction'>
>;

export const connectionToSQLiteProjectionInitContext = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  session: {
    pool: Dumbo;
    driver?: Driver;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  },
  connection: AnyConnection,
): SQLiteProjectionInitContext<Driver> =>
  ({
    execute: connection.execute,
    driverType: session.pool.driverType,
    driver: session.driver,
    session: {
      ...session,
      connection,
    },
    observabilityScope: noopScope,
  }) as SQLiteProjectionInitContext<Driver>;

export type SQLiteProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  SQLiteProjectionHandlerContext<Driver>
>;

export type SQLiteProjectionDefinition<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = ProjectionDefinition<
  EventType,
  SQLiteReadEventMetadata,
  SQLiteProjectionHandlerContext<Driver>,
  EventPayloadType,
  unknown,
  SQLiteProjectionInitContext<Driver>
> & {
  withDefaultSchemaName?: (
    databaseSchemaName: string,
  ) => SQLiteProjectionDefinition<EventType, EventPayloadType, Driver>;
};

export type SQLiteProjectionHandlerOptions<
  EventType extends Event = Event,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  events: ReadEvent<EventType, SQLiteReadEventMetadata>[];
  projections: SQLiteProjectionDefinition<EventType, EventType, Driver>[];
} & SQLiteProjectionHandlerContext<Driver>;

export const handleProjections = async <
  EventType extends Event = Event,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteProjectionHandlerOptions<EventType, Driver>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    session,
    execute,
    driver,
    driverType,
  } = options;

  for (const projection of allProjections) {
    const filteredEvents = events.filter(({ type }) =>
      projection.canHandle.includes(type),
    );

    if (filteredEvents.length === 0) continue;

    await projection.handle(filteredEvents, {
      session,
      execute,
      driver,
      driverType,
      migrationOptions: options.migrationOptions,
      observabilityScope: options.observabilityScope,
    });
  }
};

export const sqliteProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  definition: SQLiteProjectionDefinition<EventType, EventPayloadType, Driver>,
): SQLiteProjectionDefinition<EventType, EventPayloadType, Driver> =>
  projection<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext<Driver>,
    EventPayloadType,
    unknown,
    SQLiteProjectionInitContext<Driver>
  >(definition);

export type SQLiteRawBatchSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType[],
    context: SQLiteProjectionHandlerContext<Driver>,
  ) => Promise<SQL[]> | SQL[];
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionInitContext<Driver>>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
  schema?: AnyDatabaseComponent;
} & JSONSerializationOptions;

export const sqliteRawBatchSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteRawBatchSQLProjection<EventType, EventPayloadType, Driver>,
): SQLiteProjectionDefinition<EventType, EventPayloadType, Driver> =>
  sqliteProjection<EventType, EventPayloadType, Driver>({
    name: options.name,
    kind: options.kind ?? 'emt:projections:sqlite:raw_sql:batch',
    version: options.version,
    canHandle: options.canHandle,
    eventsOptions: options.eventsOptions,
    schema: options.schema,
    withDefaultSchemaName: (databaseSchemaName) =>
      sqliteRawBatchSQLProjection({
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

export type SQLiteRawSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType,
    context: SQLiteProjectionHandlerContext<Driver>,
  ) => Promise<SQL[]> | SQL[] | Promise<SQL> | SQL;
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionInitContext<Driver>>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
  schema?: AnyDatabaseComponent;
} & JSONSerializationOptions;

export const sqliteRawSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteRawSQLProjection<EventType, EventPayloadType, Driver>,
): SQLiteProjectionDefinition<EventType, EventPayloadType, Driver> => {
  const { evolve, kind, ...rest } = options;
  return sqliteRawBatchSQLProjection<EventType, EventPayloadType, Driver>({
    kind: kind ?? 'emt:projections:sqlite:raw:_sql:single',
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
