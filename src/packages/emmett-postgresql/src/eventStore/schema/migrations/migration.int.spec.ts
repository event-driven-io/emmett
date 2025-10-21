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
import { schema_0_36_0 } from './schema_0_36_0';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number } }
>;

void describe('appendEvent', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;
  let eventStore: PostgresEventStore;

  beforeEach(async () => {
    postgres = await new PostgreSqlContainer().start();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
    });

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
});
