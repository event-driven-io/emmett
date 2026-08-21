import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { eventStoreSchemaMigrations, schemaSQL as migrationSchemaSQL } from '.';
import { schemaSQL } from './index';

void describe('PostgreSQL event store database schemas', () => {
  void it('uses unqualified objects when the user does not configure database schemas', () => {
    const databaseSchema = eventStoreDatabaseSchema();

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: undefined,
      migrationTable: undefined,
      isDefaultSchema: true,
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
      isDefaultSchema: false,
    });
  });

  void it('uses separate projection and migration schemas when the user configures them', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTableDatabaseSchemaName: 'infrastructure',
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: { schemaName: 'infrastructure' },
      isDefaultSchema: false,
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
      isDefaultSchema: true,
    });
  });

  void it('keeps event objects unqualified when the user only configures the migration table schema', () => {
    const databaseSchema = eventStoreDatabaseSchema({
      migrationTableDatabaseSchemaName: 'infrastructure',
    });

    assertDeepEqual(databaseSchema, {
      databaseSchemaName: undefined,
      projectionsDatabaseSchemaName: undefined,
      migrationTable: { schemaName: 'infrastructure' },
      isDefaultSchema: true,
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
      isDefaultSchema: false,
    });
  });

  void it('does not turn omitted schemas into public', () => {
    const databaseSchema = eventStoreDatabaseSchema({});

    assertEqual(databaseSchema.databaseSchemaName, undefined);
    assertEqual(databaseSchema.projectionsDatabaseSchemaName, undefined);
    assertEqual(databaseSchema.migrationTable, undefined);
    assertTrue(databaseSchema.isDefaultSchema);
  });

  void it('uses default-schema mode only when the user omits the event schema', () => {
    const explicitPublic = eventStoreDatabaseSchema({
      databaseSchemaName: 'public',
    });
    const omitted = eventStoreDatabaseSchema({});

    assertFalse(explicitPublic.isDefaultSchema);
    assertTrue(omitted.isDefaultSchema);
  });

  void it('prints the same default schema SQL used by migrations', () => {
    assertEqual(
      SQL.describe(schemaSQL, pgFormatter),
      SQL.describe(migrationSchemaSQL, pgFormatter),
    );
    assertEqual(
      SQL.describe(eventStoreSchemaMigrations.at(-1)?.sqls ?? [], pgFormatter),
      SQL.describe(migrationSchemaSQL, pgFormatter),
    );
  });
});

void describe('EventStoreDatabaseSchemaOptions type', () => {
  void it('allows the user to configure event, projection and migration schemas', () => {
    const options: EventStoreDatabaseSchemaOptions = {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTableDatabaseSchemaName: 'infrastructure',
    };

    assertDeepEqual(options, {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTableDatabaseSchemaName: 'infrastructure',
    });
  });
});
