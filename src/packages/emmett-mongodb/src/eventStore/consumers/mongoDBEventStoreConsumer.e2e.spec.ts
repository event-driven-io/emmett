import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertMatches,
  assertThatArray,
  assertThrowsAsync,
  type Message,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, MongoNotConnectedError } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { MongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import { getMongoDBEventStore, toStreamName } from '../mongoDBEventStore';
import { type ShoppingCartEvent } from '../../testing';
import { v4 as uuid } from 'uuid';

describe('MongoDBEventStoreConsumer', () => {
  let mongodb: StartedMongoDBContainer;
  let client: MongoClient;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });
  });

  after(async () => {
    try {
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  it('should publish applicable messages to subscribers when events are appended in the event store', async () => {
    const messagesPublishedToProductItemAdded: ShoppingCartEvent[] = [];
    const messagesPublishedToDiscountApplied: ShoppingCartEvent[] = [];

    const consumer = new MongoDBEventStoreConsumer<ShoppingCartEvent>()
      .subscribe({
        canHandle: ['ProductItemAdded'],
        handle: (events) => {
          messagesPublishedToProductItemAdded.push(...events);
        },
      })
      .subscribe({
        canHandle: ['DiscountApplied'],
        handle: (events) => {
          messagesPublishedToDiscountApplied.push(...events);
        },
      });

    const eventStore = getMongoDBEventStore({
      client,
      hooks: {
        onAfterCommit: (events) => {
          consumer.publish(events);
        },
      },
    });

    const shoppingCardId = uuid();
    const streamType = 'shopping_cart';
    const streamName = toStreamName(streamType, shoppingCardId);

    const productItemEvents: (ShoppingCartEvent & {
      type: 'ProductItemAdded';
    })[] = [
      {
        type: 'ProductItemAdded',
        data: {
          productItem: {
            price: 1,
            productId: 'productId1',
            quantity: 1,
          },
        },
      },
      {
        type: 'ProductItemAdded',
        data: {
          productItem: {
            price: 2,
            productId: 'productId2',
            quantity: 2,
          },
        },
      },
      {
        type: 'ProductItemAdded',
        data: {
          productItem: {
            price: 3,
            productId: 'productId3',
            quantity: 3,
          },
        },
      },
    ];

    const discountAppliedEvent: ShoppingCartEvent & {
      type: 'DiscountApplied';
    } = {
      type: 'DiscountApplied',
      data: {
        couponId: 'couponId',
        percent: 10,
      },
    };

    await eventStore.appendToStream(streamName, [
      // Events appending in any order
      productItemEvents[0]!,
      discountAppliedEvent,
      productItemEvents[1]!,
      productItemEvents[2]!,
    ]);

    assertEqual(
      productItemEvents.length,
      messagesPublishedToProductItemAdded.length,
    );
    for (const message of messagesPublishedToProductItemAdded) {
      const expectedMessage = productItemEvents.find(
        (e) =>
          // @ts-expect-error expecting this property to exist
          e.data.productItem.productId === message.data.productItem.productId,
      );
      assertIsNotNull(expectedMessage!);
      assertMatches(message, expectedMessage);
    }

    assertEqual(1, messagesPublishedToDiscountApplied.length);
    assertMatches(messagesPublishedToDiscountApplied[0], discountAppliedEvent);
  });
});
