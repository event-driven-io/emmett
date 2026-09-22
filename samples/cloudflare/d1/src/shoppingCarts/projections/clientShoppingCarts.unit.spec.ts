import type { ReadEvent } from '@event-driven-io/emmett';
import type { SQLiteReadEventMetadata } from '@event-driven-io/emmett-sqlite';
import { describe, expect, it } from 'vitest';
import type { ShoppingCartEvent } from '../shoppingCart';
import { evolve, type ClientShoppingCarts } from './clientShoppingCarts';

describe('clientShoppingCarts projection', () => {
  const clientId = 'client-1';
  const now = new Date('2026-09-13T10:00:00.000Z');
  const cartId = (number: number) => `shopping_cart-${clientId}:${number}`;

  const opened = (number: number): ShoppingCartEvent => ({
    type: 'ShoppingCartOpened',
    data: { shoppingCartId: cartId(number), clientId, openedAt: now },
    metadata: { clientId },
  });

  const confirmed = (number: number): ShoppingCartEvent => ({
    type: 'ShoppingCartConfirmed',
    data: { shoppingCartId: cartId(number), confirmedAt: now },
    metadata: { clientId },
  });

  const cancelled = (number: number): ShoppingCartEvent => ({
    type: 'ShoppingCartCancelled',
    data: { shoppingCartId: cartId(number), cancelledAt: now },
    metadata: { clientId },
  });

  const project = (...events: ShoppingCartEvent[]) =>
    events
      .map(
        (event, index) =>
          ({
            ...event,
            metadata: {
              ...event.metadata,
              messageId: crypto.randomUUID(),
              streamName: event.data.shoppingCartId,
              streamPosition: 1n,
              globalPosition: String(index + 1),
            },
          }) as ReadEvent<ShoppingCartEvent, SQLiteReadEventMetadata>,
      )
      .reduce<ClientShoppingCarts | null>(evolve, null);

  it('has no pointer before the first cart is opened', () => {
    expect(project()).toBeNull();
  });

  it('points to the first opened cart', () => {
    expect(project(opened(1))).toEqual({
      clientId,
      lastCartNumber: 1,
      lastShoppingCartId: cartId(1),
      status: 'Opened',
    });
  });

  it('marks the last cart as closed after confirmation', () => {
    expect(project(opened(1), confirmed(1))).toEqual({
      clientId,
      lastCartNumber: 1,
      lastShoppingCartId: cartId(1),
      status: 'Closed',
    });
  });

  it('marks the last cart as closed after cancellation', () => {
    expect(project(opened(1), cancelled(1))).toEqual({
      clientId,
      lastCartNumber: 1,
      lastShoppingCartId: cartId(1),
      status: 'Closed',
    });
  });

  it('points to the next cart after the previous one was closed', () => {
    expect(project(opened(1), confirmed(1), opened(2))).toEqual({
      clientId,
      lastCartNumber: 2,
      lastShoppingCartId: cartId(2),
      status: 'Opened',
    });
  });
});
