import {
  describeSQL,
  getFormatter,
  JSONSerializer,
  schemaComponent,
  schemaComponentMigrator,
  sqlMigration,
  type AnyConnection,
  type AnyDatabaseTransaction,
  type AnySchemaComponent,
  type DatabaseDriverType,
  type Dumbo,
  type MigratorOptions,
  type RunSQLMigrationsResult,
  type SchemaComponentMigrateOptions,
  type SQL,
  type SQLExecutor,
  type SQLMigration,
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
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema/eventStoreDatabaseSchema';
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
  EventPayloadType
>;

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
    EventPayloadType
  >(definition);

export type SQLiteProjectionEnsureMigratedOptions = Pick<
  MigratorOptions,
  'dryRun' | 'ignoreMigrationHashMismatch' | 'migrationTimeoutMS'
>;

export type SQLiteProjectionSchemaContext = {
  execute: SQLExecutor;
  session: { pool: Dumbo };
} & EventStoreSchemaMigrationOptions;

export type SQLiteProjectionSchema = {
  component(options?: EventStoreDatabaseSchemaOptions): AnySchemaComponent;
  migrations(
    options?: EventStoreDatabaseSchemaOptions,
  ): ReadonlyArray<SQLMigration>;
  sql(options?: EventStoreDatabaseSchemaOptions): string;
  print(options?: EventStoreDatabaseSchemaOptions): void;
  migrate(
    context: SQLiteProjectionSchemaContext,
    options?: SchemaComponentMigrateOptions,
  ): Promise<RunSQLMigrationsResult>;
  ensureMigrated(
    context: SQLiteProjectionSchemaContext,
    options?: SQLiteProjectionEnsureMigratedOptions,
  ): Promise<void>;
};

export type SQLiteProjectionWithSchema<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = SQLiteProjectionDefinition<EventType, EventPayloadType, Driver> & {
  schema: SQLiteProjectionSchema;
};

export const isSQLiteProjectionWithSchema = <Projection extends object>(
  projection: Projection,
): projection is Projection & { schema: SQLiteProjectionSchema } =>
  'schema' in projection &&
  typeof projection.schema === 'object' &&
  projection.schema !== null &&
  'component' in projection.schema &&
  typeof projection.schema.component === 'function';

export const sqliteProjectionSchema = (
  componentFor: (schema: EventStoreDatabaseSchema) => AnySchemaComponent,
): SQLiteProjectionSchema => {
  const component = (options?: EventStoreDatabaseSchemaOptions) =>
    componentFor(eventStoreDatabaseSchema(options));

  const sql = (options?: EventStoreDatabaseSchemaOptions) =>
    describeSQL(
      component(options)
        .migrations()
        .flatMap(({ sqls }) => sqls),
      getFormatter('SQLite'),
      JSONSerializer,
    );

  const migrator = (context: SQLiteProjectionSchemaContext) =>
    schemaComponentMigrator({
      pool: context.session.pool,
      component: component(context.migrationOptions),
      migrationTable: eventStoreDatabaseSchema(context.migrationOptions)
        .migrationTable,
      ignoreMigrationHashMismatch:
        context.migrationOptions?.ignoreMigrationHashMismatch,
      migrationTimeoutMS: context.migrationOptions?.migrationTimeoutMS,
      execute: context.execute,
    });

  return {
    component,
    migrations: (options) => component(options).migrations(),
    sql,
    print: (options) => console.log(sql(options)),
    migrate: (context, options) => migrator(context).migrate(options),
    ensureMigrated: (context, options) =>
      migrator(context).ensureMigrated(options),
  };
};

export type SQLiteRawSQLProjectionSchemaOptions =
  | { schema?: AnySchemaComponent; migrations?: never; init?: never }
  | { schema?: never; migrations?: SQLMigration[]; init?: never }
  | {
      schema?: never;
      migrations?: never;
      /**
       * @deprecated Use `migrations` or `schema` instead.
       *
       * The returned SQL runs once, as the migration named
       * `emt:projections:<projection name>:init`. If you change the SQL later,
       * migrating fails with a migration hash mismatch. Add the change as a new
       * migration in `migrations` instead.
       *
       * @example
       * migrations: [
       *   sqlMigration('product_sales:create', [
       *     SQL`CREATE TABLE IF NOT EXISTS product_sales (id TEXT PRIMARY KEY)`,
       *   ]),
       * ],
       */
      init?: () => SQL | SQL[];
    };

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
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & SQLiteRawSQLProjectionSchemaOptions &
  JSONSerializationOptions;

export const sqliteRawBatchSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteRawBatchSQLProjection<EventType, EventPayloadType, Driver>,
): SQLiteProjectionDefinition<EventType, EventPayloadType, Driver> => {
  const definition = sqliteProjection<EventType, EventPayloadType, Driver>({
    name: options.name,
    kind: options.kind ?? 'emt:projections:sqlite:raw_sql:batch',
    version: options.version,
    canHandle: options.canHandle,
    eventsOptions: options.eventsOptions,
    handle: async (events, context) => {
      const sqls: SQL[] = await options.evolve(events, context);

      await context.execute.batchCommand(sqls);
    },
  });

  const { init, migrations } = options;
  const migrationsOf = migrations
    ? () => migrations
    : init
      ? () => [
          sqlMigration(`emt:projections:${options.name}:init`, [init()].flat()),
        ]
      : undefined;
  const component =
    options.schema ??
    (migrationsOf
      ? schemaComponent('emt:projections:sqlite:raw_sql', {
          migrations: migrationsOf,
        })
      : undefined);

  if (!component) return definition;

  const withSchema: SQLiteProjectionWithSchema<
    EventType,
    EventPayloadType,
    Driver
  > = {
    ...definition,
    schema: sqliteProjectionSchema(() => component),
  };

  return withSchema;
};

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
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & SQLiteRawSQLProjectionSchemaOptions &
  JSONSerializationOptions;

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
