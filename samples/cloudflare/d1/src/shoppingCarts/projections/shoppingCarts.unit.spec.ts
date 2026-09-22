import type { ReadEvent } from '@event-driven-io/emmett';
import type { SQLiteReadEventMetadata } from '@event-driven-io/emmett-sqlite';
import { describe, expect, it } from 'vitest';
import type { ShoppingCartEvent } from '../shoppingCart';
import { evolve, type ShoppingCart } from './shoppingCarts';

describe('shoppingCarts projection', () => {
  const clientId = 'client-1';
  const shoppingCartId = `shopping_cart-${clientId}:1`;
  const openedAt = new Date('2026-09-13T10:00:00.000Z');
  const confirmedAt = new Date('2026-09-13T11:00:00.000Z');
  const cancelledAt = new Date('2026-09-13T12:00:00.000Z');

  const opened: ShoppingCartEvent = {
    type: 'ShoppingCartOpened',
    data: { shoppingCartId, clientId, openedAt },
    metadata: { clientId },
  };

  const added = (
    productId: string,
    quantity: number,
    unitPrice: number,
  ): ShoppingCartEvent => ({
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      clientId,
      productItem: { productId, quantity, unitPrice },
      addedAt: openedAt,
    },
    metadata: { clientId },
  });

  const removed = (
    productId: string,
    quantity: number,
    unitPrice: number,
  ): ShoppingCartEvent => ({
    type: 'ProductItemRemovedFromShoppingCart',
    data: {
      shoppingCartId,
      productItem: { productId, quantity, unitPrice },
      removedAt: openedAt,
    },
    metadata: { clientId },
  });

  const confirmed: ShoppingCartEvent = {
    type: 'ShoppingCartConfirmed',
    data: { shoppingCartId, confirmedAt },
    metadata: { clientId },
  };

  const cancelled: ShoppingCartEvent = {
    type: 'ShoppingCartCancelled',
    data: { shoppingCartId, cancelledAt },
    metadata: { clientId },
  };

  const project = (...events: ShoppingCartEvent[]) =>
    events
      .map(
        (event, index) =>
          ({
            ...event,
            metadata: {
              ...event.metadata,
              messageId: crypto.randomUUID(),
              streamName: shoppingCartId,
              streamPosition: BigInt(index + 1),
              globalPosition: String(index + 1),
            },
          }) as ReadEvent<ShoppingCartEvent, SQLiteReadEventMetadata>,
      )
      .reduce<ShoppingCart | null>(evolve, null);

  const openedCart: ShoppingCart = {
    _id: shoppingCartId,
    clientId,
    productItems: [],
    productItemsCount: 0,
    totalAmount: 0,
    status: 'Opened',
    openedAt,
    streamPosition: 1n,
  };

  it('shows an opened cart without products', () => {
    expect(project(opened)).toEqual(openedCart);
  });

  it('shows added products with the cart totals', () => {
    expect(
      project(
        opened,
        added('product-1', 2, 1_000),
        added('product-2', 1, 2_500),
        added('product-1', 1, 1_000),
      ),
    ).toEqual({
      ...openedCart,
      productItems: [
        { productId: 'product-1', quantity: 3, unitPrice: 1_000 },
        { productId: 'product-2', quantity: 1, unitPrice: 2_500 },
      ],
      productItemsCount: 4,
      totalAmount: 5_500,
      streamPosition: 4n,
    });
  });

  it('reduces the product quantity and the cart totals', () => {
    expect(
      project(
        opened,
        added('product-1', 2, 1_000),
        removed('product-1', 1, 1_000),
      ),
    ).toEqual({
      ...openedCart,
      productItems: [{ productId: 'product-1', quantity: 1, unitPrice: 1_000 }],
      productItemsCount: 1,
      totalAmount: 1_000,
      streamPosition: 3n,
    });
  });

  it('removes the product line when its quantity reaches zero', () => {
    expect(
      project(
        opened,
        added('product-1', 2, 1_000),
        removed('product-1', 2, 1_000),
      ),
    ).toEqual({ ...openedCart, streamPosition: 3n });
  });

  it('shows a confirmed cart', () => {
    expect(project(opened, added('product-1', 1, 1_000), confirmed)).toEqual({
      ...openedCart,
      productItems: [{ productId: 'product-1', quantity: 1, unitPrice: 1_000 }],
      productItemsCount: 1,
      totalAmount: 1_000,
      status: 'Confirmed',
      confirmedAt,
      streamPosition: 3n,
    });
  });

  it('shows a cancelled cart', () => {
    expect(project(opened, added('product-1', 1, 1_000), cancelled)).toEqual({
      ...openedCart,
      productItems: [{ productId: 'product-1', quantity: 1, unitPrice: 1_000 }],
      productItemsCount: 1,
      totalAmount: 1_000,
      status: 'Cancelled',
      cancelledAt,
      streamPosition: 3n,
    });
  });
});
