import type { ReadEvent } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { beforeAll, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../sqlite3';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../../testing/shoppingCart.domain';
import {
  eventInStream,
  eventsInStream,
  newEventsInStream,
  SQLiteProjectionSpec,
} from '../sqliteProjectionSpec';
import { pongoMultiStreamProjection } from './pongoProjections';
import { documentExists, expectPongoDocuments } from './pongoProjectionSpec';

void describe('Postgres Projections', () => {
  let given: SQLiteProjectionSpec<ProductItemAdded | ShoppingCartConfirmed>;
  let shoppingCartId: string;
  let clientId: string;

  beforeAll(() => {
    given = SQLiteProjectionSpec.for({
      projection: shoppingCartsSummaryProjection,
      driver: sqlite3EventStoreDriver,
      fileName: ':memory:',
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = `shoppingCart:${clientId}:${uuid()}`;
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
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        documentExists<ShoppingCartSummary>(
          {
            activeCount: 1,
            activeShopingCarts: [shoppingCartId],
          },
          {
            inCollection: shoppingCartsSummaryCollectionName,
            withId: clientId,
          },
        ),
      ));

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>(
            shoppingCartsSummaryCollectionName,
          )
          .withId(clientId)
          .toBeEqual({
            activeCount: 1,
            activeShopingCarts: [shoppingCartId],
          }),
      ));

  void it('with empty given and when eventsInStream', () => {
    const otherShoppingCartId = `shoppingCart:${clientId}:${uuid()}`;

    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(otherShoppingCartId, [
          {
            type: 'ProductItemAdded',
            data: {
              productItem: { price: 30, productId: 'shoes', quantity: 30 },
            },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>(
            shoppingCartsSummaryCollectionName,
          )
          .withId(clientId)
          .toBeEqual({
            activeCount: 2,
            activeShopingCarts: [shoppingCartId, otherShoppingCartId],
          }),
      );
  });

  void it('with idempotency check', () => {
    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'ProductItemAdded',
            data: {
              productItem: { price: 100, productId: 'shoes', quantity: 100 },
            },
          },
        ]),
        { numberOfTimes: 2 },
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartSummary>(
            shoppingCartsSummaryCollectionName,
          )
          .withId(clientId)
          .toBeEqual({
            activeCount: 1,
            activeShopingCarts: [shoppingCartId],
          }),
      );
  });
});

type ShoppingCartSummary = {
  _id?: string;
  activeCount: number;
  activeShopingCarts: string[];
};

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

const evolve = (
  document: ShoppingCartSummary,
  {
    type,
    metadata: { streamName },
  }: ReadEvent<ProductItemAdded | ShoppingCartConfirmed>,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded': {
      if (!document.activeShopingCarts.includes(streamName)) {
        document.activeShopingCarts.push(streamName);
        document.activeCount++;
      }

      return document;
    }
    case 'ShoppingCartConfirmed':
      document.activeShopingCarts = document.activeShopingCarts.filter(
        (item) => item !== streamName,
      );
      document.activeCount--;

      return document;
    default:
      return document;
  }
};

const shoppingCartsSummaryProjection = pongoMultiStreamProjection({
  getDocumentId: (event) => event.metadata.streamName.split(':')[1]!,
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    activeCount: 0,
    activeShopingCarts: [],
  }),
});
