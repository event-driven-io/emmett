import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  projections,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from './postgreSQLEventStore';
import { postgreSQLProjection } from './projections';
import { pongoSingleStreamProjection } from './projections/pongo/pongoProjections';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

void describe('EventStoreDBEventStore', () => {
  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;
  let connectionString: string;
  let pongo: PongoClient;

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };
  let clientId: string;
  let shoppingCartId: string;
  let schemaHookCreationHookCalls = 0;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    pongo = pongoClient(connectionString);
  });

  beforeEach(() => {
    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([
        shoppingCartShortInfoProjection,
        customProjection,
      ]),
      hooks: {
        onAfterSchemaCreated: () => {
          schemaHookCreationHookCalls++;
        },
      },
    });
    clientId = uuid();
    shoppingCartId = `shopping_cart-${clientId}`;
    schemaHookCreationHookCalls = 0;
  });

  afterEach(async () => {
    try {
      await eventStore.close();
    } catch (error) {
      console.log(error);
    }
  });

  after(async () => {
    try {
      await pongo.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should create schema only once ', async () => {
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);

    assertEqual(1, schemaHookCreationHookCalls);
  });

  void it('should create schema only once with session', async () => {
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);
    await eventStore.withSession(({ eventStore: session }) =>
      session.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: { productItem },
          metadata: { clientId },
        },
      ]),
    );

    assertEqual(1, schemaHookCreationHookCalls);
  });

  void it('should create schema only once with session before a regular append', async () => {
    await eventStore.withSession(({ eventStore: session }) =>
      session.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: { productItem },
          metadata: { clientId },
        },
      ]),
    );
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);

    assertEqual(1, schemaHookCreationHookCalls);
  });

  void it('should create schema only once with two sessions', async () => {
    await eventStore.withSession(({ eventStore: session }) =>
      session.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: { productItem },
          metadata: { clientId },
        },
      ]),
    );
    await eventStore.withSession(({ eventStore: session }) =>
      session.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: { productItem },
          metadata: { clientId },
        },
      ]),
    );

    assertEqual(1, schemaHookCreationHookCalls);
  });

  void it('should append events correctly using appendEvent function', async () => {
    const discount = 10;
    handledEventsInCustomProjection = [];

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { clientId },
      },
    ]);
    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'DiscountApplied',
        data: { percent: discount, couponId: uuid() },
        metadata: { clientId },
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

type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

type ShoppingCartEventMetadata = { clientId: string };

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem },
  ShoppingCartEventMetadata
>;
type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string },
  ShoppingCartEventMetadata
>;
type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { confirmedAt: Date },
  ShoppingCartEventMetadata
>;

type ShoppingCartEvent =
  | ProductItemAdded
  | DiscountApplied
  | ShoppingCartConfirmed;

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
