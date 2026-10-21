import {
  describeSQL,
  getFormatter,
  isSchemaComponent,
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
  readonly component: AnySchemaComponent;
  readonly migrations: ReadonlyArray<SQLMigration>;
  sql(): string;
  print(): void;
  withDatabaseSchemaName(databaseSchemaName: string): SQLiteProjectionSchema;
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
  isSchemaComponent(projection.schema.component);

export const sqliteProjectionWithDatabaseSchemaName = <
  Projection extends object,
>(
  projection: Projection,
  databaseSchemaName: string | undefined,
): Projection =>
  databaseSchemaName !== undefined && isSQLiteProjectionWithSchema(projection)
    ? {
        ...projection,
        schema: projection.schema.withDatabaseSchemaName(databaseSchemaName),
      }
    : projection;

const hasDefaultSchemaName = (
  component: AnySchemaComponent,
): component is AnySchemaComponent & {
  withDefaultSchemaName: (
    defaultSchemaName: string | undefined,
  ) => AnySchemaComponent;
} =>
  'withDefaultSchemaName' in component &&
  typeof component.withDefaultSchemaName === 'function';

export const sqliteProjectionSchema = (
  component: AnySchemaComponent,
): SQLiteProjectionSchema => {
  const sql = () =>
    describeSQL(
      component.migrations().flatMap(({ sqls }) => sqls),
      getFormatter('SQLite'),
      JSONSerializer,
    );

  const migrator = (context: SQLiteProjectionSchemaContext) =>
    schemaComponentMigrator({
      pool: context.session.pool,
      component,
      migrationTable: context.migrationOptions?.migrationTable,
      ignoreMigrationHashMismatch:
        context.migrationOptions?.ignoreMigrationHashMismatch,
      migrationTimeoutMS: context.migrationOptions?.migrationTimeoutMS,
      execute: context.execute,
    });

  const schema: SQLiteProjectionSchema = {
    component,
    get migrations() {
      return component.migrations();
    },
    sql,
    print: () => console.log(sql()),
    withDatabaseSchemaName: (databaseSchemaName) => {
      if (!hasDefaultSchemaName(component)) return schema;

      const mapped = component.withDefaultSchemaName(databaseSchemaName);

      return mapped === component ? schema : sqliteProjectionSchema(mapped);
    },
    migrate: (context, options) => migrator(context).migrate(options),
    ensureMigrated: (context, options) =>
      migrator(context).ensureMigrated(options),
  };

  return schema;
};

export type SQLiteSchemaOptions = {
  schema?: { definition?: AnySchemaComponent };
  migrations?: SQLMigration[];
};

export const sqliteSchemaOf = (
  options: SQLiteSchemaOptions,
  databaseSchemaName: string | undefined,
): SQLiteProjectionSchema | undefined => {
  const { migrations } = options;
  const component =
    options.schema?.definition ??
    (migrations
      ? schemaComponent('emt:processors:sqlite', {
          migrations: () => migrations,
        })
      : undefined);

  if (!component) return undefined;

  const schema = sqliteProjectionSchema(component);

  return databaseSchemaName !== undefined
    ? schema.withDatabaseSchemaName(databaseSchemaName)
    : schema;
};

export type SQLiteRawSQLProjectionSchemaOptions =
  | (SQLiteSchemaOptions & { init?: never })
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
    options.schema?.definition ??
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
    schema: sqliteProjectionSchema(component),
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
