import type { Event } from '@event-driven-io/emmett';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  expectPongoDocuments,
  pongoSingleStreamProjection,
  PostgreSQLProjectionSpec,
} from '.';
import type { PricedProductItem } from '../../testing/shoppingCart.domain';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; shoppingCartId: string }
>;

void describe('Postgres Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<ProductItemAdded>;
  let shoppingCartId: string;
  let streamName: string;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
  });

  beforeEach(() => {
    shoppingCartId = uuid();
    streamName = `shoppingCart:${shoppingCartId}`;
  });

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('uses custom document id instead of stream name assigned in projection evolve', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
            shoppingCartId,
          },
          metadata: {
            streamName,
          },
        },
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            _id: shoppingCartId,
            productItemsCount: 100,
            totalAmount: 10000,
          }),
      ));
});

type ShoppingCartShortInfo = {
  _id?: string;
  productItemsCount: number;
  totalAmount: number;
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ProductItemAdded,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        _id: event.shoppingCartId,
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  getDocumentId: (event) => event.data.shoppingCartId,
  canHandle: ['ProductItemAdded'],
  initialState: () => ({
    productItemsCount: 0,
    totalAmount: 0,
  }),
});
