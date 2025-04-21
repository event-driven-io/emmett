import { beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  documentExists,
  eventInStream,
  eventsInStream,
  expectInMemoryDocuments,
  inMemoryMultiStreamProjection,
  InMemoryProjectionSpec,
  newEventsInStream,
} from '.';
import {
  type ProductItemAdded,
  type ShoppingCartConfirmed,
} from '../../../testing/shoppingCart.domain';
import type { ReadEvent } from '../../../typing';

void describe('InMemory Multi-Stream Projections', () => {
  let given: ReturnType<
    typeof InMemoryProjectionSpec.for<ProductItemAdded | ShoppingCartConfirmed>
  >;
  let shoppingCartId: string;
  let clientId: string;

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = `shoppingCart:${clientId}:${uuid()}`;

    given = InMemoryProjectionSpec.for({
      projection: shoppingCartsSummaryProjection,
    });
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
        expectInMemoryDocuments
          .fromCollection<ShoppingCartSummary>(
            shoppingCartsSummaryCollectionName,
          )
          .withId(clientId)
          .toBeEqual({
            activeCount: 1,
            activeShopingCarts: [shoppingCartId],
          }),
      ));

  void it('should aggregate events from multiple streams with same client ID', () => {
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
        expectInMemoryDocuments
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

  void it('with idempotency check when adding same cart multiple times', () => {
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
        expectInMemoryDocuments
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

  void it('should remove shopping cart from active list when confirmed', () => {
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
            type: 'ShoppingCartConfirmed',
            data: {
              confirmedAt: new Date(),
            },
          },
        ]),
      )
      .then(
        expectInMemoryDocuments
          .fromCollection<ShoppingCartSummary>(
            shoppingCartsSummaryCollectionName,
          )
          .withId(clientId)
          .toBeEqual({
            activeCount: 0,
            activeShopingCarts: [],
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
  document: ShoppingCartSummary | null,
  {
    type,
    metadata: { streamName },
  }: ReadEvent<ProductItemAdded | ShoppingCartConfirmed>,
): ShoppingCartSummary | null => {
  // Initialize document if null
  if (!document) {
    document = {
      activeCount: 0,
      activeShopingCarts: [],
    };
  }

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

const shoppingCartsSummaryProjection = inMemoryMultiStreamProjection({
  getDocumentId: (event) => event.metadata.streamName.split(':')[1]!,
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    activeCount: 0,
    activeShopingCarts: [],
  }),
});
