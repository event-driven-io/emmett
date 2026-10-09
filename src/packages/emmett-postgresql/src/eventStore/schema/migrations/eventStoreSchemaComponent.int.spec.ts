import { dumbo, PendingMigrationsError, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { assertThrowsAsync } from '@event-driven-io/emmett';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../../testing/postgreSQLTestDatabase';
import { eventStoreSchemaComponent } from './eventStoreSchemaComponent';

void describe('PostgreSQL event store schema component', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    pool = dumbo({
      driver: pgDumboDriver,
      connectionString: database.connectionString,
    });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it('does not share migration state between instances', async () => {
    const schema = { databaseSchemaName: 'emt_schema_component_memo' };
    const migrated = eventStoreSchemaComponent({ pool, schema });
    const other = eventStoreSchemaComponent({ pool, schema });

    await migrated.migrator.migrate();
    await pool.execute.command(
      SQL`DROP SCHEMA ${SQL.identifier(schema.databaseSchemaName)} CASCADE`,
    );

    await migrated.migrator.ensureMigrated();
    await assertThrowsAsync(
      () => other.migrator.ensureMigrated(),
      (error) => error instanceof PendingMigrationsError,
    );
  });
});
