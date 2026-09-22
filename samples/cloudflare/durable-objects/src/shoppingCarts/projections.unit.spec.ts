import type { ReadEvent } from '@event-driven-io/emmett';
import { describe, expect, it } from 'vitest';
import { evolveClientShoppingCarts, evolveShoppingCart } from './projections';
import type {
  ClientShoppingCarts,
  ShoppingCart,
  ShoppingCartEvent,
} from './shoppingCart';

describe('Shopping cart projections', () => {
  const clientId = 'client-1';
  const shoppingCartId = `shopping_cart-${clientId}:1`;
  const openedAt = new Date('2026-09-13T10:00:00.000Z');
  const closedAt = new Date('2026-09-13T11:00:00.000Z');

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
      removedAt: closedAt,
    },
    metadata: { clientId },
  });

  const confirmed: ShoppingCartEvent = {
    type: 'ShoppingCartConfirmed',
    data: { shoppingCartId, confirmedAt: closedAt },
    metadata: { clientId },
  };

  const cancelled: ShoppingCartEvent = {
    type: 'ShoppingCartCancelled',
    data: { shoppingCartId, cancelledAt: closedAt },
    metadata: { clientId },
  };

  const inStream = (
    events: ShoppingCartEvent[],
    streamPositionOf = (index: number) => BigInt(index + 1),
  ): ReadEvent<ShoppingCartEvent>[] =>
    events.map((event, index) => ({
      ...event,
      kind: 'Event',
      metadata: {
        ...event.metadata,
        messageId: crypto.randomUUID(),
        streamName: shoppingCartId,
        streamPosition: streamPositionOf(index),
      },
    }));

  describe('shoppingCarts', () => {
    const project = (events: ShoppingCartEvent[]) =>
      inStream(events).reduce<ShoppingCart | null>(evolveShoppingCart, null);

    it('opens an empty cart', () => {
      expect(project([opened])).toEqual({
        _id: shoppingCartId,
        clientId,
        productItems: [],
        productItemsCount: 0,
        totalAmount: 0,
        status: 'Opened',
        openedAt,
        streamPosition: 1n,
      });
    });

    it('adds products and updates the totals', () => {
      expect(
        project([
          opened,
          added('product-1', 2, 1_000),
          added('product-2', 1, 2_500),
          added('product-1', 1, 1_000),
        ]),
      ).toMatchObject({
        productItems: [
          { productId: 'product-1', quantity: 3, unitPrice: 1_000 },
          { productId: 'product-2', quantity: 1, unitPrice: 2_500 },
        ],
        productItemsCount: 4,
        totalAmount: 5_500,
        streamPosition: 4n,
      });
    });

    it('removes products and updates the totals', () => {
      expect(
        project([
          opened,
          added('product-1', 2, 1_000),
          added('product-2', 1, 2_500),
          removed('product-1', 1, 1_000),
          removed('product-2', 1, 2_500),
        ]),
      ).toMatchObject({
        productItems: [
          { productId: 'product-1', quantity: 1, unitPrice: 1_000 },
        ],
        productItemsCount: 1,
        totalAmount: 1_000,
        streamPosition: 5n,
      });
    });

    it('confirms the cart', () => {
      expect(
        project([opened, added('product-1', 1, 1_000), confirmed]),
      ).toMatchObject({
        status: 'Confirmed',
        confirmedAt: closedAt,
        streamPosition: 3n,
      });
    });

    it('keeps the stream version when events come from separate appends', () => {
      const appendedOneByOne = inStream(
        [opened, added('product-1', 1, 1_000), added('product-2', 1, 2_500)],
        () => 1n,
      );

      expect(
        appendedOneByOne.reduce<ShoppingCart | null>(evolveShoppingCart, null),
      ).toMatchObject({ streamPosition: 3n });
    });

    it('cancels the cart', () => {
      expect(
        project([opened, added('product-1', 1, 1_000), cancelled]),
      ).toMatchObject({
        status: 'Cancelled',
        cancelledAt: closedAt,
        streamPosition: 3n,
      });
    });
  });

  describe('clientShoppingCarts', () => {
    const cart = (number: number) => `shopping_cart-${clientId}:${number}`;

    const openedCart = (number: number): ShoppingCartEvent => ({
      type: 'ShoppingCartOpened',
      data: { shoppingCartId: cart(number), clientId, openedAt },
      metadata: { clientId },
    });

    const confirmedCart = (number: number): ShoppingCartEvent => ({
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId: cart(number), confirmedAt: closedAt },
      metadata: { clientId },
    });

    const cancelledCart = (number: number): ShoppingCartEvent => ({
      type: 'ShoppingCartCancelled',
      data: { shoppingCartId: cart(number), cancelledAt: closedAt },
      metadata: { clientId },
    });

    const project = (events: ShoppingCartEvent[]) =>
      inStream(events).reduce<ClientShoppingCarts | null>(
        evolveClientShoppingCarts,
        null,
      );

    it('has no pointer before the first cart is opened', () => {
      expect(project([])).toBeNull();
    });

    it('points to the first opened cart', () => {
      expect(project([openedCart(1)])).toEqual({
        clientId,
        lastCartNumber: 1,
        lastShoppingCartId: cart(1),
        status: 'Opened',
      });
    });

    it('marks the cart as closed when it is confirmed', () => {
      expect(project([openedCart(1), confirmedCart(1)])).toEqual({
        clientId,
        lastCartNumber: 1,
        lastShoppingCartId: cart(1),
        status: 'Closed',
      });
    });

    it('marks the cart as closed when it is cancelled', () => {
      expect(project([openedCart(1), cancelledCart(1)])).toMatchObject({
        status: 'Closed',
      });
    });

    it('points to the next cart after the previous one was closed', () => {
      expect(project([openedCart(1), confirmedCart(1), openedCart(2)])).toEqual(
        {
          clientId,
          lastCartNumber: 2,
          lastShoppingCartId: cart(2),
          status: 'Opened',
        },
      );
    });
  });
});
