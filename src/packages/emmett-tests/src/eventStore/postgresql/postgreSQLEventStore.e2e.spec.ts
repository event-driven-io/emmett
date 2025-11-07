import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  getPostgreSQLEventStore,
  pongoSingleStreamProjection,
  postgreSQLProjection,
  type PostgresEventStore,
} from '@event-driven-io/emmett-postgresql';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  testAggregateStream,
  testCommandHandling,
  type EventStoreFactory,
} from '../features';
import {
  type DiscountApplied,
  type PricedProductItem,
  type ProductItemAdded,
  type ShoppingCartEvent,
} from '../shoppingCart.domain';

void describe('EventStoreDBEventStore', async () => {
  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;
  let connectionString: string;
  let pongo: PongoClient;

  const eventStoreFactory: EventStoreFactory = async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: [
        { type: 'inline', projection: shoppingCartShortInfoProjection },
        { type: 'inline', projection: customProjection },
      ],
    });
    pongo = pongoClient(connectionString);
    return eventStore;
  };

  after(async () => {
    try {
      await eventStore.close();
      await pongo.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  await testAggregateStream(eventStoreFactory, {
    getInitialIndex: () => 1n,
  });

  await testCommandHandling(eventStoreFactory, {
    getInitialIndex: () => 1n,
  });

  void it('should append events correctly using appendEvent function', async () => {
    const productItem: PricedProductItem = {
      productId: 'p123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = `shopping_cart-${uuid()}`;
    handledEventsInCustomProjection = [];

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'DiscountApplied',
        data: { percent: discount, couponId: uuid() },
      },
    ]);

    const shoppingCartShortInfo = pongo
      .db()
      .collection<ShoppingCartShortInfo>(shoppingCartShortInfoCollectionName);

    const document = await shoppingCartShortInfo.findOne({
      _id: shoppingCartId,
    });
    assertIsNotNull(document);
    assertDeepEqual(
      { ...document, _id: shoppingCartId },
      {
        _id: shoppingCartId,
        productItemsCount: 20,
        totalAmount: 54,
        _version: 3n,
      },
    );

    assertEqual(3, handledEventsInCustomProjection.length);
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
  document = document ?? { productItemsCount: 0, totalAmount: 0 };

  switch (type) {
    case 'ProductItemAdded':
      return {
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
});

let handledEventsInCustomProjection: ReadEvent<ShoppingCartEvent>[] = [];

const customProjection = postgreSQLProjection<ShoppingCartEvent>({
  name: 'customProjection',
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  handle: (events) => {
    handledEventsInCustomProjection.push(...events);
  },
});
