import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertEqual,
  assertThatArray,
  assertTrue,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema } from '.';
import type { PostgresReadEventMetadata } from '../postgreSQLEventStore';
import {
  appendToStream,
  type AppendToStreamBeforeCommitHook,
} from './appendToStream';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem },
  { meta: string }
>;
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number },
  { meta: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('appendEvent', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = dumbo({
      connectionString: postgres.getConnectionUri(),
    });

    await createEventStoreSchema(pool);
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const events: ShoppingCartEvent[] = [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: '1', quantity: 2, price: 30 } },
      metadata: { meta: 'data1' },
    },
    {
      type: 'DiscountApplied',
      data: { percent: 10 },
      metadata: { meta: 'data2' },
    },
  ];

  // void it('should append events correctly using appendEvent function', async () => {
  //   const result = await appendToStream(pool, uuid(), 'shopping_cart', events, {
  //     expectedStreamVersion: 0n,
  //   });

  //   assertTrue(result.success);
  //   assertEqual(result.nextStreamPosition, 2n);
  //   assertIsNotNull(result.globalPositions);
  //   assertThatArray(result.globalPositions).isNotEmpty();
  //   assertThatArray(result.globalPositions).hasSize(events.length);
  //   assertTrue(result.globalPositions[result.globalPositions.length - 1]! > 0n);
  //   assertOk(result.transactionId);
  // });

  // void it('should append events correctly without expected stream position', async () => {
  //   const result = await appendToStream(
  //     pool,
  //     uuid(),
  //     'shopping_cart',
  //     events,
  //     {},
  //   );

  //   assertTrue(result.success);
  //   assertEqual(result.nextStreamPosition, 2n);
  //   assertIsNotNull(result.globalPositions);
  //   assertThatArray(result.globalPositions).isNotEmpty();
  //   assertThatArray(result.globalPositions).hasSize(events.length);
  //   assertTrue(result.globalPositions[result.globalPositions.length - 1]! > 0n);
  //   assertOk(result.transactionId);
  // });

  // void it('should increment stream position in events correctly without expected stream position', async () => {
  //   const streamId = uuid();

  //   let result = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {},
  //   );

  //   assertTrue(result.success);
  //   assertEqual(result.nextStreamPosition, 2n);

  //   result = await appendToStream(pool, streamId, 'shopping_cart', events, {});

  //   assertTrue(result.success);
  //   assertEqual(4n, result.nextStreamPosition);
  //   assertIsNotNull(result.globalPositions);
  //   assertThatArray(result.globalPositions).isNotEmpty();
  //   assertThatArray(result.globalPositions).hasSize(events.length);
  //   assertTrue(result.globalPositions[result.globalPositions.length - 1]! > 0n);
  //   assertOk(result.transactionId);
  // });

  void it('should increment stream position in events from beforeCommitHook correctly without expected stream position', async () => {
    let messagesFromHook: RecordedMessage<
      ShoppingCartEvent,
      PostgresReadEventMetadata
    >[] = [];

    const beforeCommitHook: AppendToStreamBeforeCommitHook = (messages) => {
      messagesFromHook = [
        ...messagesFromHook,
        ...(messages as RecordedMessage<
          ShoppingCartEvent,
          PostgresReadEventMetadata
        >[]),
      ];
      return Promise.resolve();
    };

    const streamId = uuid();

    let result = await appendToStream(pool, streamId, 'shopping_cart', events, {
      beforeCommitHook,
    });

    assertTrue(result.success);
    assertEqual(result.nextStreamPosition, 2n);

    result = await appendToStream(pool, streamId, 'shopping_cart', events, {
      beforeCommitHook,
    });

    assertTrue(result.success);
    assertEqual(4n, result.nextStreamPosition);
    assertThatArray(
      messagesFromHook.map((m) => m.metadata.streamPosition),
    ).containsElements([1n, 2n, 3n, 4n]);
  });

  // void it('should increment stream position in events correctly with expected stream position', async () => {
  //   const streamId = uuid();

  //   let result = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {},
  //   );

  //   assertTrue(result.success);
  //   assertEqual(result.nextStreamPosition, 2n);

  //   result = await appendToStream(pool, streamId, 'shopping_cart', events, {
  //     expectedStreamVersion: result.nextStreamPosition,
  //   });

  //   assertTrue(result.success);
  //   assertEqual(4n, result.nextStreamPosition);
  //   assertIsNotNull(result.globalPositions);
  //   assertThatArray(result.globalPositions).isNotEmpty();
  //   assertThatArray(result.globalPositions).hasSize(events.length);
  //   assertTrue(result.globalPositions[result.globalPositions.length - 1]! > 0n);
  //   assertOk(result.transactionId);
  // });

  // void it('should handle stream position conflict correctly when two streams are created', async () => {
  //   // Given
  //   const streamId = uuid();

  //   const firstResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion: 0n,
  //     },
  //   );
  //   assertTrue(firstResult.success);

  //   // When
  //   const secondResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion: 0n,
  //     },
  //   );

  //   // Then
  //   assertFalse(secondResult.success);

  //   const resultEvents = await pool.execute.query(
  //     sql(`SELECT * FROM emt_messages WHERE stream_id = %L`, streamId),
  //   );

  //   assertEqual(events.length, resultEvents.rows.length);
  // });

  // void it('should handle stream position conflict correctly when version mismatches', async () => {
  //   // Given
  //   const streamId = uuid();

  //   const creationResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //   );
  //   assertTrue(creationResult.success);
  //   const expectedStreamVersion = creationResult.nextStreamPosition;

  //   const firstResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion,
  //     },
  //   );
  //   assertTrue(firstResult.success);

  //   // When
  //   const secondResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion,
  //     },
  //   );

  //   // Then
  //   assertFalse(secondResult.success);

  //   const resultEvents = await pool.execute.query(
  //     sql(`SELECT * FROM emt_messages WHERE stream_id = %L`, streamId),
  //   );

  //   assertEqual(events.length * 2, resultEvents.rows.length);
  // });

  // void it('should not have stream position conflict when version matches', async () => {
  //   // Given
  //   const streamId = uuid();
  //   const expectedStreamVersion = 0n;

  //   const firstResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion,
  //     },
  //   );
  //   assertTrue(firstResult.success);

  //   // When
  //   const secondResult = await appendToStream(
  //     pool,
  //     streamId,
  //     'shopping_cart',
  //     events,
  //     {
  //       expectedStreamVersion: firstResult.nextStreamPosition,
  //     },
  //   );

  //   // Then
  //   assertTrue(secondResult.success);

  //   const resultEvents = await pool.execute.query(
  //     sql(`SELECT * FROM emt_messages WHERE stream_id = %L`, streamId),
  //   );

  //   assertEqual(events.length * 2, resultEvents.rows.length);
  // });

  // void it('should handle appending an empty events array gracefully', async () => {
  //   const result = await appendToStream(pool, uuid(), 'shopping_cart', []);

  //   assertFalse(result.success);
  // });
});
