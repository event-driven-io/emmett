import { dumbo, single, SQL, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertFalse,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { clearRegisteredDumboDrivers } from '../../testing/dumboDriverIsolation';
import {
  isolatedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import type {
  ProductItemAdded,
  ShoppingCartEvent,
} from '../../testing/shoppingCart.domain';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import { postgreSQLRawSQLProjection } from '../projections';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import { rebuildPostgreSQLProjections } from './rebuildPostgreSQLProjections';
import { pgEventStoreDriver } from '../../pg';

const withDeadline = { timeout: 30000 };

void describe('Postgres consumer without registered dumbo drivers', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let restoreDumboDrivers: () => void;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

  const withVerificationPool = async (
    handle: (pool: Dumbo) => Promise<void>,
  ) => {
    const pool = dumbo({
      driver: pgDumboDriver,
      connectionString,
      transactionOptions: { allowNestedTransactions: true },
    });

    try {
      await handle(pool);
    } finally {
      await pool.close();
    }
  };

  const appendProductItemAdded = async (streamName: string, count: number) => {
    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
      schema: { autoMigration: 'None' },
    });

    try {
      return await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        Array.from({ length: count }, () => ({
          type: 'ProductItemAdded' as const,
          data: { productItem },
        })),
      );
    } finally {
      await eventStore.close();
    }
  };

  beforeAll(async () => {
    database = await isolatedPostgreSQLDatabase();
    connectionString = database.connectionString;

    restoreDumboDrivers = clearRegisteredDumboDrivers();

    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
      schema: { autoMigration: 'None' },
    });
    try {
      await eventStore.schema.migrate();
    } finally {
      await eventStore.close();
    }
  });

  beforeEach(async () => {
    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
      schema: { autoMigration: 'None' },
    });
    try {
      await eventStore.schema.dangerous.truncate({
        resetSequences: true,
        truncateProjections: true,
      });
    } finally {
      await eventStore.close();
    }
  });

  afterAll(async () => {
    restoreDumboDrivers?.();
    await database?.close();
  });

  void it(
    'builds its own pool from a connection string alone',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const appendResult = await appendProductItemAdded(streamName, 1);
      const handled: string[] = [];

      const consumer = postgreSQLEventStoreConsumer<ShoppingCartEvent>({
        connectionString,
      });
      consumer.reactor<ShoppingCartEvent>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: (event) => {
          handled.push(event.type);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertEqual(1, handled.length);
      assertEqual('ProductItemAdded', handled[0]);
      assertFalse(consumer.isRunning);
    },
  );

  void it(
    'opens no pool of its own when handed a Dumbo instance',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const appendResult = await appendProductItemAdded(streamName, 1);
      const handled: string[] = [];

      const pool = dumbo({
        driver: pgDumboDriver,
        connectionString,
        transactionOptions: { allowNestedTransactions: true },
      });

      const consumer = postgreSQLEventStoreConsumer<ShoppingCartEvent>({
        connectionString,
        pool,
      });
      consumer.reactor<ShoppingCartEvent>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: (event) => {
          handled.push(event.type);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await pool.close();
      }

      assertEqual(1, handled.length);
      assertEqual('ProductItemAdded', handled[0]);
    },
  );

  void it(
    'builds the processor pool and the nested message store from a connection string alone',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const reactionStream = `reaction-${uuid()}`;
      const appendResult = await appendProductItemAdded(streamName, 1);

      const consumer = postgreSQLEventStoreConsumer<ShoppingCartEvent>({
        connectionString,
      });
      consumer.reactor<ShoppingCartEvent>({
        processorId: uuid(),
        connectionOptions: { connectionString },
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: async (_event, context) => {
          await context.session.messageStore.appendToStream(reactionStream, [
            {
              type: 'ShoppingCartConfirmed',
              data: { confirmedAt: new Date() },
            },
          ]);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      await withVerificationPool(async (pool) => {
        const reactions = await single<{ count: number }>(
          pool.execute.query(
            SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
          ),
        );
        assertEqual(1, reactions.count);
      });
    },
  );

  void it(
    'rebuilds projections from a connection string alone',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const tableName = `driver_rebuild_${uuid().replaceAll('-', '_')}`;
      await appendProductItemAdded(streamName, 2);

      const consumer = rebuildPostgreSQLProjections<ProductItemAdded>({
        connectionString,
        projection: postgreSQLRawSQLProjection<ProductItemAdded>({
          name: `driver-rebuild-${uuid()}`,
          canHandle: ['ProductItemAdded'],
          init: () =>
            SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(tableName)} (event_id TEXT PRIMARY KEY, quantity INT)`,
          evolve: (event) =>
            SQL`INSERT INTO ${SQL.identifier(tableName)} (event_id, quantity) VALUES (${(event as ReadEvent<ProductItemAdded>).metadata.messageId}, ${event.data.productItem.quantity})`,
        }),
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      await withVerificationPool(async (pool) => {
        const projected = await single<{ count: number }>(
          pool.execute.query(
            SQL`SELECT COUNT(*)::int AS count FROM ${SQL.identifier(tableName)}`,
          ),
        );
        assertEqual(2, projected.count);
      });
    },
  );

  void it(
    'connects from driver options alone, with no top-level connection string',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const appendResult = await appendProductItemAdded(streamName, 1);
      const handled: string[] = [];

      const consumer = postgreSQLEventStoreConsumer<ShoppingCartEvent>({
        driver: pgEventStoreDriver,
        connectionOptions: { connectionString },
      });
      consumer.reactor<ShoppingCartEvent>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: (event) => {
          handled.push(event.type);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertEqual(1, handled.length);
    },
  );
});
