import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertMatches,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../postgreSQLEventStore';
import { schema_0_36_0 } from './0_36_0';
import { schema_0_38_7 } from './0_38_7';
import { schema_0_42_0 } from './0_42_0';
import { cleanupLegacySubscriptionTables } from './0_43_0';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number } }
>;

void describe('Schema migrations tests', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeEach(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
    });

    // TODO: Change setup to schemas, when they're supported in Emmett instead of using separate containers
    eventStore = getPostgreSQLEventStore(connectionString, {
      connectionOptions: { dumbo: pool },
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    try {
      await eventStore.close();
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const assertCanAppendAndRead = async (eventStore: PostgresEventStore) => {
    const streamId = 'cart-123';
    const event: ProductItemAdded = {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'product-456', quantity: 2 } },
    };

    await eventStore.appendToStream(streamId, [event]);

    const { events, streamExists, currentStreamVersion } =
      await eventStore.readStream<ProductItemAdded>(streamId);

    assertTrue(streamExists);
    assertDeepEqual(currentStreamVersion, 1n);
    assertDeepEqual(events.length, 1);
    assertMatches(events[0], event);
  };

  void it('can migrate from 0.36.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_36_0);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.38.7 schema', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.38.7 schema with subscription cleanup', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    // When
    await cleanupLegacySubscriptionTables(connectionString);

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.42.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_42_0);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from latest schema', async () => {
    // Given
    // console.log(eventStore.schema.sql());
    await eventStore.schema.migrate();

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });
});
