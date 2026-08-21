import type { SQL } from '@event-driven-io/dumbo';
import { JSONSerializer } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertTrue,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { eventStoreSchemaMigrations, eventStoreSchemaSQL } from '.';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import { schemaSQL } from './eventStoreSchemaSQL';

void describe('PostgreSQL event store database schemas', () => {
  const describePostgreSQL = (sql: SQL | SQL[]): string =>
    pgFormatter.describe(sql, { serializer: JSONSerializer });

  void it('uses unqualified objects when the user does not configure database schemas', () => {
    const databaseSchema = eventStoreDatabaseSchema();

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: undefined,
      migrationTable: undefined,
    });
  });

  void it('uses the event schema for projections and migrations when the user only sets one schema', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      databaseSchemaName: 'events',
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'events',
      migrationTable: { schemaName: 'events' },
    });
  });

  void it('uses separate projection and migration schemas when the user configures them', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    });
  });

  void it('uses a custom migration table name in the event schema when the user configures it', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      databaseSchemaName: 'events',
      migrationTable: { tableName: 'emmett_migrations' },
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'events',
      migrationTable: {
        schemaName: 'events',
        tableName: 'emmett_migrations',
      },
    });
  });

  void it('uses a custom migration table name in the default schema when the user only configures the table name', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      migrationTable: { tableName: 'emmett_migrations' },
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: undefined,
      migrationTable: { tableName: 'emmett_migrations' },
    });
  });

  void it('keeps event objects unqualified when the user only configures the projection schema', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      projectionsDatabaseSchemaName: 'read_models',
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: undefined,
    });
  });

  void it('keeps event objects unqualified when the user only configures the migration table schema', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      migrationTable: { schemaName: 'infrastructure' },
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: undefined,
      migrationTable: { schemaName: 'infrastructure' },
    });
  });

  void it('treats public as explicit when the user configures it', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      databaseSchemaName: 'public',
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: 'public',
      projectionsDatabaseSchemaName: 'public',
      migrationTable: { schemaName: 'public' },
    });
  });

  void it('does not turn omitted schemas into public', () => {
    const databaseSchema = eventStoreDatabaseSchema({});

    assertEqual(databaseSchema.databaseSchemaName, undefined);
    assertEqual(databaseSchema.projectionsDatabaseSchemaName, undefined);
    assertEqual(databaseSchema.migrationTable, undefined);
  });

  void it('uses default-schema mode only when the user omits the event schema', () => {
    const explicitPublic = eventStoreDatabaseSchema({
      databaseSchemaName: 'public',
    });
    const omitted = eventStoreDatabaseSchema({});

    assertEqual(explicitPublic.databaseSchemaName, 'public');
    assertEqual(omitted.databaseSchemaName, undefined);
  });

  void it('prints the same default schema SQL used by migrations', () => {
    assertEqual(
      describePostgreSQL(eventStoreSchemaMigrations.at(-1)?.sqls ?? []),
      describePostgreSQL(schemaSQL),
    );
  });

  void it('keeps the current schema migration tolerant to hash changes', () => {
    assertTrue(eventStoreSchemaMigrations.at(-1)?.ignoreHashMismatch === true);
  });

  void it('prints schema-qualified SQL when the user configures the event schema', () => {
    const printedSQL = describePostgreSQL(
      eventStoreSchemaSQL({ databaseSchemaName: 'events' }),
    );

    assertTrue(printedSQL.includes('CREATE SCHEMA IF NOT EXISTS events'));
    assertTrue(
      printedSQL.includes('CREATE TABLE IF NOT EXISTS events.emt_streams'),
    );
    assertTrue(
      printedSQL.includes(
        'CREATE SEQUENCE IF NOT EXISTS events.emt_global_message_position',
      ),
    );
    assertTrue(
      printedSQL.includes(
        'CREATE OR REPLACE FUNCTION events.emt_append_to_stream',
      ),
    );
    assertTrue(printedSQL.includes('SELECT events.emt_add_partition'));
  });

  void it('prints the same configured schema SQL from the event store and migrations', () => {
    const eventStore = getPostgreSQLEventStore('postgresql://localhost/test', {
      schema: { autoMigration: 'None', databaseSchemaName: 'events' },
    });

    try {
      assertEqual(
        eventStore.schema.sql(),
        describePostgreSQL(
          eventStoreSchemaSQL({ databaseSchemaName: 'events' }),
        ),
      );
    } finally {
      void eventStore.close();
    }
  });
});

void describe('EventStoreDatabaseSchemaOptions type', () => {
  void it('allows the user to configure event, projection and migration schemas', () => {
    const options: EventStoreDatabaseSchemaOptions = {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    };

    assertDeepEqual(options, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    });
  });
});
