import { SQL } from '@event-driven-io/dumbo';
import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  projections,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../../sqlite3';
import type { ProductItemAdded } from '../../../../testing/shoppingCart.domain';
import { getSQLiteEventStore } from '../../../../eventStore/SQLiteEventStore';
import { sqliteRawSQLProjection } from '../../../../eventStore/projections/sqliteProjection';

void describe('SQLite projection registration', () => {
  void it('initializes an inline projection as inline', async () => {
    let registrationType: ProjectionHandlingType | undefined;

    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      projections: projections.inline([
        sqliteRawSQLProjection<ProductItemAdded>({
          name: 'product_sales',
          canHandle: ['ProductItemAdded'],
          init: (options) => {
            registrationType = options.registrationType;
            return SQL`SELECT 1;`;
          },
          evolve: () => SQL`SELECT 1;`,
        }),
      ]),
    });

    try {
      await eventStore.schema.migrate();

      assertEqual(registrationType, 'inline');
    } finally {
      await eventStore.close();
    }
  });
});
