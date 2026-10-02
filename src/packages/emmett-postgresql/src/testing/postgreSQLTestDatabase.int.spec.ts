import { assertThrowsAsync } from '@event-driven-io/emmett';
import { endPgPool, getPgPool } from '@event-driven-io/dumbo/pg';
import { describe, it } from 'vitest';
import { sharedPostgreSQLDatabase } from './postgreSQLTestDatabase';

describe('sharedPostgreSQLDatabase', () => {
  it('refuses to drop the database while a spec still holds a pooled connection', async () => {
    const database = await sharedPostgreSQLDatabase();
    const pool = getPgPool(database.connectionString);
    const client = await pool.connect();
    client.release();

    try {
      await assertThrowsAsync(
        () => database.close(),
        (error) => /being accessed by other users/.test(error.message),
      );
    } finally {
      await endPgPool({ connectionString: database.connectionString });
      await database.close();
    }
  });
});
