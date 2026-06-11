import { describe, it } from 'vitest';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../testing/shoppingCart.domain';
import { pongoMultiStreamProjection, pongoSingleStreamProjection } from '.';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const collectionName = 'shoppingCartShortInfo';

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
    default:
      return document;
  }
};

const initialState = (): ShoppingCartShortInfo => ({
  productItemsCount: 0,
  totalAmount: 0,
});

void describe('Pongo projection document id options', () => {
  void it('accepts getDocumentId returning a string', () => {
    pongoMultiStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >({
      collectionName,
      evolve,
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      initialState,
      getDocumentId: (event) => event.metadata.streamName,
    });
  });

  void it('accepts getDocumentId returning null', () => {
    pongoMultiStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >({
      collectionName,
      evolve,
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      initialState,
      getDocumentId: (event) =>
        event.type === 'ProductItemAdded' ? event.metadata.streamName : null,
    });
  });

  void it('accepts getDocumentIds returning an array', () => {
    pongoMultiStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >({
      collectionName,
      evolve,
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      initialState,
      getDocumentIds: (event) => [event.metadata.streamName],
    });
  });

  void it('rejects passing both getDocumentId and getDocumentIds', () => {
    pongoMultiStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >(
      // @ts-expect-error getDocumentId and getDocumentIds are mutually exclusive
      {
        collectionName,
        evolve,
        canHandle: ['ProductItemAdded', 'DiscountApplied'],
        initialState,
        getDocumentId: (event) => event.metadata.streamName,
        getDocumentIds: (event) => [event.metadata.streamName],
      },
    );
  });

  void it('rejects a multi stream projection without getDocumentId or getDocumentIds', () => {
    pongoMultiStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >(
      // @ts-expect-error a multi stream projection requires getDocumentId or getDocumentIds
      {
        collectionName,
        evolve,
        canHandle: ['ProductItemAdded', 'DiscountApplied'],
        initialState,
      },
    );
  });

  void it('accepts a single stream projection without getDocumentId (defaults to stream name)', () => {
    pongoSingleStreamProjection<
      ShoppingCartShortInfo,
      ProductItemAdded | DiscountApplied
    >({
      collectionName,
      evolve,
      canHandle: ['ProductItemAdded', 'DiscountApplied'],
      initialState,
    });
  });
});
