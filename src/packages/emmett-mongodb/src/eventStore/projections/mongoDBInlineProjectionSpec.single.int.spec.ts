import {
  MongoDBContainer,
  StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  type DiscountApplied,
  type ProductItemAdded,
} from '../../testing/shoppingCart.domain';
import { toStreamName, type StreamName } from '../mongoDBEventStore';
import {
  MongoDBDefaultInlineProjectionName,
  mongoDBInlineProjection,
} from './mongoDBInlineProjection';
import {
  eventsInStream,
  expectInlineReadModel,
  MongoDBInlineProjectionSpec,
} from './mongoDBInlineProjectionSpec';

type ShoppingCartId = StreamName<'shopping_cart'>;

void describe('Postgres Projections', () => {
  let mongodb: StartedMongoDBContainer;
  let client: MongoClient;
  let given: MongoDBInlineProjectionSpec<
    ShoppingCartId,
    ProductItemAdded | DiscountApplied
  >;
  let streamName: ShoppingCartId;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    given = MongoDBInlineProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      client,
    });
  });

  beforeEach(
    () => (streamName = toStreamName('shopping_cart', `${uuid()}:${uuid()}`)),
  );

  after(async () => {
    try {
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('with empty given', () =>
    given({ streamName, events: [] })
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ])
      .then(
        expectInlineReadModel.toHave({
          productItemsCount: 100,
          totalAmount: 10000,
          appliedDiscounts: [],
        }),
      ));

  void it('with given set up with eventsInStream and withName check', () => {
    const couponId = uuid();

    return given(
      eventsInStream(streamName, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when([
        {
          type: 'DiscountApplied',
          data: { percent: 10, couponId },
        },
      ])
      .then(
        expectInlineReadModel
          .withName(MongoDBDefaultInlineProjectionName)
          .toHave({
            productItemsCount: 100,
            totalAmount: 9000,
            appliedDiscounts: [couponId],
          }),
      );
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const evolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      // idempotence check
      if (document.appliedDiscounts.includes(event.couponId)) return document;

      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
        appliedDiscounts: [...document.appliedDiscounts, event.couponId],
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = mongoDBInlineProjection({
  evolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});
