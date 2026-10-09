import { PendingMigrationsError, SQL } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Pool,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import { assertThrowsAsync } from '@event-driven-io/emmett';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { eventStoreSchemaComponent } from '../../../../eventStore/schema/eventStoreSchemaComponent';

void describe('SQLite event store schema component', () => {
  let pool: Sqlite3Pool;

  beforeAll(() => {
    pool = sqlite3Pool({ fileName: InMemorySQLiteDatabase });
  });

  afterAll(async () => {
    await pool.close();
  });

  void it('does not share migration state between instances', async () => {
    const migrated = eventStoreSchemaComponent({ pool });
    const other = eventStoreSchemaComponent({ pool });

    await migrated.migrator.migrate();
    await pool.execute.command(SQL`DROP TABLE dmb_migrations`);

    await migrated.migrator.ensureMigrated();
    await assertThrowsAsync(
      () => other.migrator.ensureMigrated(),
      (error) => error instanceof PendingMigrationsError,
    );
  });
});
