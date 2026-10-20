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
import type { PgEventStoreDriver } from '../../pg';
import type {
  AnyPostgreSQLEventStoreDriver,
  InferDumboConnectionFromEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  InferTransactionFromEventStoreDriver,
} from '../eventStoreDriver';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema/eventStoreDatabaseSchema';
import { defaultTag } from '../schema/typing';
import { postgreSQLProjectionLock } from './locks';
import { registerProjection } from './management';

export type PostgreSQLProjectionHandlerContext<
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
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
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
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

export type PostgreSQLProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  PostgreSQLProjectionHandlerContext<Driver>
>;

export type PostgreSQLProjectionDefinition<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = ProjectionDefinition<
  EventType,
  PostgresReadEventMetadata,
  PostgreSQLProjectionHandlerContext<Driver>,
  EventPayloadType
>;

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
        databaseSchemaName:
          options.context.migrationOptions?.databaseSchemaName,
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

export type PostgreSQLProjectionEnsureMigratedOptions = Pick<
  MigratorOptions,
  'dryRun' | 'ignoreMigrationHashMismatch' | 'migrationTimeoutMS'
>;

export type PostgreSQLProjectionSchemaContext = {
  execute: SQLExecutor;
  session: { pool: Dumbo };
} & EventStoreSchemaMigrationOptions;

export type PostgreSQLProjectionSchema = {
  component(options?: EventStoreDatabaseSchemaOptions): AnySchemaComponent;
  migrations(
    options?: EventStoreDatabaseSchemaOptions,
  ): ReadonlyArray<SQLMigration>;
  sql(options?: EventStoreDatabaseSchemaOptions): string;
  print(options?: EventStoreDatabaseSchemaOptions): void;
  migrate(
    context: PostgreSQLProjectionSchemaContext,
    options?: SchemaComponentMigrateOptions,
  ): Promise<RunSQLMigrationsResult>;
  ensureMigrated(
    context: PostgreSQLProjectionSchemaContext,
    options?: PostgreSQLProjectionEnsureMigratedOptions,
  ): Promise<void>;
};

export type PostgreSQLProjectionWithSchema<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = PostgreSQLProjectionDefinition<EventType, EventPayloadType, Driver> & {
  schema: PostgreSQLProjectionSchema;
};

export const isPostgreSQLProjectionWithSchema = <Projection extends object>(
  projection: Projection,
): projection is Projection & { schema: PostgreSQLProjectionSchema } =>
  'schema' in projection &&
  typeof projection.schema === 'object' &&
  projection.schema !== null &&
  'component' in projection.schema &&
  typeof projection.schema.component === 'function';

export const postgreSQLProjectionSchema = (
  componentFor: (schema: EventStoreDatabaseSchema) => AnySchemaComponent,
): PostgreSQLProjectionSchema => {
  const component = (options?: EventStoreDatabaseSchemaOptions) =>
    componentFor(eventStoreDatabaseSchema(options));

  const sql = (options?: EventStoreDatabaseSchemaOptions) =>
    describeSQL(
      component(options)
        .migrations()
        .flatMap(({ sqls }) => sqls),
      getFormatter('PostgreSQL'),
      JSONSerializer,
    );

  const migrator = (context: PostgreSQLProjectionSchemaContext) =>
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

export type PostgreSQLRawSQLProjectionSchemaOptions =
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
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & PostgreSQLRawSQLProjectionSchemaOptions &
  JSONSerializationOptions;

export const postgreSQLRawBatchSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options: PostgreSQLRawBatchSQLProjection<EventType, EventPayloadType>,
): PostgreSQLProjectionDefinition<EventType, EventPayloadType> => {
  const definition = postgreSQLProjection<EventType, EventPayloadType>({
    name: options.name,
    kind: options.kind ?? 'emt:projections:postgresql:raw_sql:batch',
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
      ? schemaComponent('emt:projections:postgresql:raw_sql', {
          migrations: migrationsOf,
        })
      : undefined);

  if (!component) return definition;

  const withSchema: PostgreSQLProjectionWithSchema<
    EventType,
    EventPayloadType
  > = {
    ...definition,
    schema: postgreSQLProjectionSchema(() => component),
  };

  return withSchema;
};

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
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & PostgreSQLRawSQLProjectionSchemaOptions &
  JSONSerializationOptions;

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
