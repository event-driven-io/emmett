import { dumbo, runSQLMigrations } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertThatArray,
  type Event,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { migrations_0_36_0 } from '.';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../../../testing/postgreSQLTestDatabase';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../../postgreSQLEventStore';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string }
>;

export type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

export type OrderInitiated = Event<
  'OrderInitiated',
  { shoppingCartId: string; orderId: string }
>;

void describe('Schema migrations tests', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeEach(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;

    pool = dumbo({
      driver: pgDumboDriver,
      connectionString,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    // TODO: Change setup to schemas, when they're supported in Emmett instead of using separate containers
    eventStore = getPostgreSQLEventStore(connectionString, {
      connectionOptions: { dumbo: pool },
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    try {
      await eventStore?.close();
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it('migrates from fresh schema', async () => {
    // Given

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_36_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_36_0);
    assertThatArray(skipped).isEmpty();
  });

  void it('migrates from 0.36.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_36_0);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_36_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_36_0);
  });
});
