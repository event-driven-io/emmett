import {
  schemaComponent,
  schemaComponentMigrator,
  type AnySchemaComponent,
  type Dumbo,
  type MigratorOptions,
  type SchemaComponentMigrator,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../eventStoreDatabaseSchema';
import { eventStoreSchemaMigrationsFor } from '.';

export type EventStoreSchemaComponentOptions = {
  pool: Dumbo;
  schema?: EventStoreDatabaseSchemaOptions | undefined;
  migrationOptions?: MigratorOptions | undefined;
};

export type EventStoreSchemaComponent = {
  readonly component: AnySchemaComponent;
  readonly migrations: ReadonlyArray<SQLMigration>;
  readonly migrator: SchemaComponentMigrator;
  add: (schema: AnySchemaComponent) => void;
};

export const eventStoreSchemaComponent = (
  options: EventStoreSchemaComponentOptions,
): EventStoreSchemaComponent => {
  const { pool, migrationOptions } = options;
  const { migrationTable } = eventStoreDatabaseSchema(options.schema);
  const eventStoreMigrations = eventStoreSchemaMigrationsFor(options.schema);
  let children: AnySchemaComponent[] = [];

  const createMigrator = () =>
    schemaComponentMigrator({
      ...migrationOptions,
      pool,
      component: schemaComponent('emt:eventStore', {
        migrations: () => eventStoreMigrations,
        components: children,
      }),
      migrationTable,
    });

  let migrator = createMigrator();

  return {
    get component() {
      return migrator.component;
    },
    get migrations() {
      return migrator.component.migrations();
    },
    get migrator() {
      return migrator;
    },
    add: (schema) => {
      if (children.includes(schema)) return;

      children = [...children, schema];
      migrator = createMigrator();
    },
  };
};
