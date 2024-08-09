import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import {
  documentExists,
  eventInStream,
  eventsInStream,
  expectPongoDocuments,
  newEventsInStream,
  pongoSingleStreamProjection,
  PostgreSQLProjectionSpec,
} from '.';
import {
  type DiscountApplied,
  type ProductItemAdded,
} from '../../../../emmett/src/testing/shoppingCart.domain';

void describe('EventStoreDBEventStore', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<ProductItemAdded | DiscountApplied>;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
  });

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: 'shopingCart1',
          },
        },
      ])
      .then(
        documentExists<ShoppingCartShortInfo>(
          {
            productItemsCount: 100,
            totalAmount: 10000,
          },
          {
            inCollection: shoppingCartShortInfoCollectionName,
            withId: 'shopingCart1',
          },
        ),
      ));

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream('shopingCart1', {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection(shoppingCartShortInfoCollectionName)
          .withId('shopingCart1')
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 10000,
          }),
      ));

  void it('with empty given and when eventsInStream', async () => {
    return given(
      eventsInStream<ProductItemAdded>('shopingCart1', [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream('shopingCart1', [
          {
            type: 'DiscountApplied',
            data: { percent: 10 },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection(shoppingCartShortInfoCollectionName)
          .withId('shopingCart1')
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9900,
          }),
      );
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
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
});
