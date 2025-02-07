import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertNotEqual,
  projections,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getMongoDBEventStore,
  mongoDBInlineProjection,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBStreamAsDocumentEventStore,
} from '../';
import {
  type DiscountApplied,
  type PricedProductItem,
  type ProductItemAdded,
  type ShoppingCartEvent,
} from '../../testing';

void describe('MongoDBEventStore', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBStreamAsDocumentEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  const streamType = 'shopping_cart';
  const discount = 10;
  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    await client.connect();
    const db = client.db();
    collection = db.collection<EventStream>(
      toStreamCollectionName('shopping_cart'),
    );

    eventStore = getMongoDBEventStore({
      client,
      projections: projections.inline([
        mongoDBInlineProjection({
          canHandle: ['ProductItemAdded', 'DiscountApplied'],
          evolve,
        }),
      ]),
    });
    return eventStore;
  });

  after(async () => {
    try {
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should append events and add projection using appendEvent function', async () => {
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertDeepEqual(stream.projections._default, {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        streamId: shoppingCartId,
        name: '_default',
        streamPosition: 3n,
        schemaVersion: 1,
      },
    });
  });

  void it('should find the projection using projections.inline.findOne with just streamType', async () => {
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const projection =
      await eventStore.projections.inline.findOne<ShoppingCartShortInfo>(
        { streamType },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
          '_metadata.streamId': { $eq: shoppingCartId },
        },
      );

    assertIsNotNull(projection);
    assertDeepEqual(projection, {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        streamId: shoppingCartId,
        name: '_default',
        streamPosition: 3n,
        schemaVersion: 1,
      },
    });
  });

  void it('should find the projection using projections.inline.findOne with streamType and streamId', async () => {
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const projection =
      await eventStore.projections.inline.findOne<ShoppingCartShortInfo>(
        { streamType, streamId: shoppingCartId },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertIsNotNull(projection);
    assertDeepEqual(projection, {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        streamId: shoppingCartId,
        name: '_default',
        streamPosition: 3n,
        schemaVersion: 1,
      },
    });
  });

  void it('should find the projection using projections.inline.findOne with streamName', async () => {
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const projection =
      await eventStore.projections.inline.findOne<ShoppingCartShortInfo>({
        streamName,
      });

    assertIsNotNull(projection);
    assertDeepEqual(projection, {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        streamId: shoppingCartId,
        name: '_default',
        streamPosition: 3n,
        schemaVersion: 1,
      },
    });
  });

  void it('should find the projection using projections.inline.findOne with streamName and projection query', async () => {
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const projection =
      await eventStore.projections.inline.findOne<ShoppingCartShortInfo>(
        { streamName },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertIsNotNull(projection);
    assertDeepEqual(projection, {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        streamId: shoppingCartId,
        name: '_default',
        streamPosition: 3n,
        schemaVersion: 1,
      },
    });
  });

  void it('should find the projections using projections.inline.find with just streamType', async () => {
    const shoppingCartIds = Array.from({ length: 5 }).map(() => uuid());

    for (const id of shoppingCartIds) {
      const streamName = toStreamName(streamType, id);
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projections =
      await eventStore.projections.inline.find<ShoppingCartShortInfo>(
        { streamType },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    for (const id of shoppingCartIds) {
      const projection = projections.find((p) => p._metadata.streamId === id);
      assertNotEqual(projection, undefined);
      assertDeepEqual(projection, {
        productItemsCount: 20,
        totalAmount: 54,
        _metadata: {
          streamId: id,
          name: '_default',
          streamPosition: 3n,
          schemaVersion: 1,
        },
      });
    }
  });

  void it('should find the projections using projections.inline.find with streamIds and streamType', async () => {
    const shoppingCartIds = Array.from({ length: 5 }).map(() => uuid());

    for (const id of shoppingCartIds) {
      const streamName = toStreamName(streamType, id);
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projections =
      await eventStore.projections.inline.find<ShoppingCartShortInfo>(
        { streamType, streamIds: shoppingCartIds },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertEqual(projections.length, shoppingCartIds.length);
    for (const id of shoppingCartIds) {
      const projection = projections.find((p) => p._metadata.streamId === id);
      assertNotEqual(projection, undefined);
      assertDeepEqual(projection, {
        productItemsCount: 20,
        totalAmount: 54,
        _metadata: {
          streamId: id,
          name: '_default',
          streamPosition: 3n,
          schemaVersion: 1,
        },
      });
    }
  });

  void it('should find the projections using projections.inline.find with streamNames', async () => {
    const shoppingCartIds = Array.from({ length: 5 }).map(() => uuid());
    const streamNames = shoppingCartIds.map((id) =>
      toStreamName(streamType, id),
    );

    for (const streamName of streamNames) {
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projections =
      await eventStore.projections.inline.find<ShoppingCartShortInfo>(
        { streamNames },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertEqual(projections.length, shoppingCartIds.length);
    for (const id of shoppingCartIds) {
      const projection = projections.find((p) => p._metadata.streamId === id);
      assertNotEqual(projection, undefined);
      assertDeepEqual(projection, {
        productItemsCount: 20,
        totalAmount: 54,
        _metadata: {
          streamId: id,
          name: '_default',
          streamPosition: 3n,
          schemaVersion: 1,
        },
      });
    }
  });

  void it('should return empty from projections.inline.find if streamNames is empty', async () => {
    const shoppingCartIds = Array.from({ length: 5 }).map(() => uuid());
    const streamNames = shoppingCartIds.map((id) =>
      toStreamName(streamType, id),
    );

    for (const streamName of streamNames) {
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projections =
      await eventStore.projections.inline.find<ShoppingCartShortInfo>(
        { streamNames: [] },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertEqual(projections.length, 0);
  });

  void it('should paginate and sort the projections using projections.inline.find', async () => {
    const shoppingCartIds = Array.from({ length: 100 })
      .map(() => uuid())
      .sort();
    const streamNames = shoppingCartIds.map((id) =>
      toStreamName(streamType, id),
    );

    for (const streamName of streamNames) {
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projections =
      await eventStore.projections.inline.find<ShoppingCartShortInfo>(
        { streamNames },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
        {
          skip: 50,
          limit: 10,
          sort: [['_metadata.streamId', 1]],
        },
      );

    assertEqual(projections.length, 10);
    for (const id of shoppingCartIds.slice(50, 60)) {
      const projection = projections.find((p) => p._metadata.streamId === id);
      assertNotEqual(projection, undefined);
      assertDeepEqual(projection, {
        productItemsCount: 20,
        totalAmount: 54,
        _metadata: {
          streamId: id,
          name: '_default',
          streamPosition: 3n,
          schemaVersion: 1,
        },
      });
    }
  });

  void it('should return the total count of projections using projections.inline.count', async () => {
    const numberOfProjections = 100;
    const shoppingCartIds = Array.from({ length: numberOfProjections })
      .map(() => uuid())
      .sort();
    const streamNames = shoppingCartIds.map((id) =>
      toStreamName(streamType, id),
    );

    for (const streamName of streamNames) {
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    }

    const projectionsCount =
      await eventStore.projections.inline.count<ShoppingCartShortInfo>(
        { streamNames },
        {
          productItemsCount: { $eq: 20 },
          totalAmount: { $gte: 20 },
          '_metadata.schemaVersion': { $eq: 1 },
        },
      );

    assertEqual(projectionsCount, numberOfProjections);
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo | null => {
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
