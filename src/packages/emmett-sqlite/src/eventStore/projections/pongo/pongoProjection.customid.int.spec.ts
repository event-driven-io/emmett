import type { Event } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { beforeAll, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../sqlite3';
import type { PricedProductItem } from '../../schema/appendToStream.d1.int.spec';
import { SQLiteProjectionSpec } from '../sqliteProjectionSpec';
import { pongoSingleStreamProjection } from './pongoProjections';
import { expectPongoDocuments } from './pongoProjectionSpec';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; shoppingCartId: string }
>;

void describe('Postgres Projections', () => {
  let given: SQLiteProjectionSpec<ProductItemAdded>;
  let shoppingCartId: string;
  let streamName: string;

  beforeAll(() => {
    given = SQLiteProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      driver: sqlite3EventStoreDriver,
      fileName: ':memory:',
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  beforeEach(() => {
    shoppingCartId = uuid();
    streamName = `shoppingCart:${shoppingCartId}`;
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
