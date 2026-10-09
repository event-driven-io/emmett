import {
  dumbo,
  schemaComponent,
  sqlMigration,
  SQL,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertNotEqual,
  assertThrows,
  assertTrue,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
import { pgDriver as pgPongoDriver } from '@event-driven-io/pongo/pg';
import { afterAll, describe, it } from 'vitest';
import type { EventStoreDatabaseSchemaOptions } from './eventStoreDatabaseSchema';
import { eventStoreSchemaComponent } from './eventStoreSchemaComponent';
import { eventStoreSchemaMigrationsFor } from './migrations';

const connectionString = 'postgresql://localhost:5432/postgres';

void describe('PostgreSQL event store schema component', () => {
  const pool = dumbo({ driver: pgDumboDriver, connectionString });
  const pongo = pongoClient({
    driver: pgPongoDriver,
    connectionString,
    defaultSchemaName: 'read_models',
  });

  afterAll(async () => {
    await pool.close();
    await pongo.close();
  });

  const describeMigrations = (migrations: ReadonlyArray<SQLMigration>) =>
    migrations.map(({ name, sqls }) => ({ name, sqls }));

  const customComponent = (sql: SQL) =>
    schemaComponent('custom', {
      migrations: () => [sqlMigration('custom:create', [sql])],
    });

  void it('starts with the event-store migrations', () => {
    const component = eventStoreSchemaComponent({ pool });

    assertDeepEqual(
      describeMigrations(component.migrations),
      describeMigrations(eventStoreSchemaMigrationsFor()),
    );
  });

  void it('starts with the event-store migrations for the configured schemas', () => {
    const schema: EventStoreDatabaseSchemaOptions = {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
    };
    const component = eventStoreSchemaComponent({ pool, schema });

    assertDeepEqual(
      describeMigrations(component.migrations),
      describeMigrations(eventStoreSchemaMigrationsFor(schema)),
    );
  });

  void it('adds the migrations of a Pongo database after the event-store migrations', () => {
    const db = pongo.db();
    db.collection('carts');
    const component = eventStoreSchemaComponent({ pool });

    component.add(db.schema.component);

    assertDeepEqual(
      describeMigrations(component.migrations),
      describeMigrations([
        ...eventStoreSchemaMigrationsFor(),
        ...db.schema.migrations,
      ]),
    );
  });

  void it('adds the migrations of any schema component', () => {
    const custom = customComponent(SQL`CREATE TABLE custom (id INT);`);
    const component = eventStoreSchemaComponent({ pool });

    component.add(custom);

    assertDeepEqual(
      describeMigrations(component.migrations),
      describeMigrations([
        ...eventStoreSchemaMigrationsFor(),
        ...custom.migrations(),
      ]),
    );
  });

  void it('includes migrations with the same name and SQL once', () => {
    const component = eventStoreSchemaComponent({ pool });

    component.add(customComponent(SQL`CREATE TABLE custom (id INT);`));
    component.add(customComponent(SQL`CREATE TABLE custom (id INT);`));

    assertDeepEqual(
      describeMigrations(component.migrations),
      describeMigrations([
        ...eventStoreSchemaMigrationsFor(),
        ...customComponent(SQL`CREATE TABLE custom (id INT);`).migrations(),
      ]),
    );
  });

  void it('rejects migrations with the same name and different SQL', () => {
    const component = eventStoreSchemaComponent({ pool });

    component.add(customComponent(SQL`CREATE TABLE custom (id INT);`));
    component.add(customComponent(SQL`CREATE TABLE custom (id TEXT);`));

    assertThrows(() => component.migrations);
  });

  void it('replaces its migrator with one for the new graph on each addition', () => {
    const component = eventStoreSchemaComponent({ pool });
    const initial = component.migrator;
    const custom = customComponent(SQL`CREATE TABLE custom (id INT);`);

    component.add(custom);

    assertNotEqual(component.migrator, initial);
    assertTrue(component.migrator.component === component.component);
    assertDeepEqual(
      describeMigrations(component.migrator.component.migrations()),
      describeMigrations([
        ...eventStoreSchemaMigrationsFor(),
        ...custom.migrations(),
      ]),
    );
  });

  void it('gives each instance its own migrator', () => {
    const first = eventStoreSchemaComponent({ pool });
    const second = eventStoreSchemaComponent({ pool });

    assertNotEqual(first.migrator, second.migrator);
  });
});
