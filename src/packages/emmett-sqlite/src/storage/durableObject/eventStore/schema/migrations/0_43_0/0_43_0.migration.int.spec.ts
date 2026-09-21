import {
  JSONSerializer,
  runSQLMigrations,
  SQL,
  single,
} from '@event-driven-io/dumbo';
import {
  cloudflareDurableObjectSQLiteConnection,
  cloudflareDurableObjectSQLitePool,
  type CloudflareDurableObjectSQLiteConnection,
  type CloudflareDurableObjectSQLiteConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertThatArray,
  type Event,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { aroundEach, describe, it } from 'vitest';
import { defaultTag } from '../../../../../../eventStore/schema/typing';
import { migrations_0_41_0 } from '../../../../../../eventStore/schema/migrations/0_41_0';
import { migrations_0_42_0 } from '../../../../../../eventStore/schema/migrations/0_42_0';
import { appendToStream } from '../../../../../../eventStore/schema/migrations/0_42_0/legacyApi';
import { migrations_0_43_0 } from '../../../../../../eventStore/schema/migrations/0_43_0';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

void describe('Schema migrations tests', () => {
  let connection: CloudflareDurableObjectSQLiteConnection;
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      connection = cloudflareDurableObjectSQLiteConnection({
        storage: state.storage,
        serializer: JSONSerializer,
      });

      pool = cloudflareDurableObjectSQLitePool({ connection });

      try {
        await runTest();
      } finally {
        await connection.close();
      }
    });
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_43_0);
    assertThatArray(skipped).isEmpty();
  });

  void it('migrates from 0.43.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_43_0);
  });

  void it('migrates pre-existing stream partition to the default partition', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    await appendToStream<ProductItemAdded>(pool.execute, {
      streamId: 'legacy-cart-1',
      streamType: 'cart',
      events: [productItemAdded('legacy-cart-1')],
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await streamPartition('legacy-cart-1'), defaultTag);
  });

  void it('leaves a pre-existing explicit stream partition untouched', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    await appendToStream<ProductItemAdded>(pool.execute, {
      streamId: 'tenant-cart-1',
      streamType: 'cart',
      events: [productItemAdded('tenant-cart-1')],
      partition: 'tenant-a',
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await streamPartition('tenant-cart-1'), 'tenant-a');
  });

  const productItemAdded = (shoppingCartId: string): ProductItemAdded => ({
    type: 'ProductItemAdded',
    data: {
      shoppingCartId,
      productItem: { productId: 'product-456', quantity: 2 },
    },
  });

  const streamPartition = async (streamId: string): Promise<string> => {
    const { partition } = await single(
      pool.execute.query<{ partition: string }>(SQL`
        SELECT partition
        FROM emt_streams
        WHERE stream_id = ${streamId}
      `),
    );

    return partition;
  };
});
