import {
  expectInlineReadModel,
  MongoDBInlineProjectionSpec,
} from '@event-driven-io/emmett-mongodb';
import {
  MongoDBContainer,
  StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  shoppingCartShortInfoProjection,
  shoppingCartShortInfoProjectionName,
} from '.';
import { ShoppingCartId, type ShoppingCartEvent } from '../shoppingCart';

void describe('Shopping Cart Short Info Projection', () => {
  let mongodb: StartedMongoDBContainer;
  let connectionString: string;
  let given: MongoDBInlineProjectionSpec<ShoppingCartId, ShoppingCartEvent>;
  let shoppingCartId: ShoppingCartId;
  let clientId: string;
  const now = new Date();

  before(async () => {
    mongodb = await new MongoDBContainer('mongo:6.0.1').start();
    connectionString = mongodb.getConnectionString();

    given = MongoDBInlineProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
      clientOptions: {
        directConnection: true,
      },
    });
  });

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = ShoppingCartId(clientId);
  });

  after(async () => {
    try {
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('adds product to empty shopping cart', () =>
    given({ streamName: shoppingCartId, events: [] })
      .when([
        {
          type: 'ProductItemAddedToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem: { unitPrice: 100, productId: 'shoes', quantity: 100 },
            addedAt: now,
          },
          metadata: {
            clientId,
          },
        },
      ])
      .then(
        expectInlineReadModel
          .withName(shoppingCartShortInfoProjectionName)
          .toHave({
            productItemsCount: 100,
            totalAmount: 10000,
          }),
      ));
});
