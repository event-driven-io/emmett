import { DeciderSpecification, EmmettError } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { decide } from './businessLogic';
import {
  evolve,
  initialState,
  type PricedProductItem,
  type ShoppingCartEvent,
} from './shoppingCart';

const given = DeciderSpecification.for({ decide, evolve, initialState });

describe('ShoppingCart', () => {
  const clientId = 'client-1';
  const shoppingCartId = `shopping_cart-${clientId}:1`;
  const openedAt = new Date('2026-09-13T10:00:00.000Z');
  const now = new Date('2026-09-13T11:00:00.000Z');
  const metadata = { clientId };

  const productItem: PricedProductItem = {
    productId: 'product-1',
    quantity: 2,
    unitPrice: 1_500,
  };

  const opened: ShoppingCartEvent = {
    type: 'ShoppingCartOpened',
    data: { shoppingCartId, clientId, openedAt },
    metadata,
  };

  const added = (item: PricedProductItem = productItem): ShoppingCartEvent => ({
    type: 'ProductItemAddedToShoppingCart',
    data: { shoppingCartId, clientId, productItem: item, addedAt: openedAt },
    metadata,
  });

  const removed = (
    item: PricedProductItem = productItem,
  ): ShoppingCartEvent => ({
    type: 'ProductItemRemovedFromShoppingCart',
    data: { shoppingCartId, productItem: item, removedAt: openedAt },
    metadata,
  });

  const confirmed: ShoppingCartEvent = {
    type: 'ShoppingCartConfirmed',
    data: { shoppingCartId, confirmedAt: openedAt },
    metadata,
  };

  const cancelled: ShoppingCartEvent = {
    type: 'ShoppingCartCancelled',
    data: { shoppingCartId, cancelledAt: openedAt },
    metadata,
  };

  const addProductItem = (item: PricedProductItem) =>
    ({
      type: 'AddProductItemToShoppingCart',
      data: { shoppingCartId, clientId, productItem: item },
      metadata: { clientId, now },
    }) as const;

  const removeProductItem = (productId: string, quantity: number) =>
    ({
      type: 'RemoveProductItemFromShoppingCart',
      data: { shoppingCartId, productId, quantity },
      metadata: { clientId, now },
    }) as const;

  const confirm = {
    type: 'ConfirmShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now },
  } as const;

  const cancel = {
    type: 'CancelShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now },
  } as const;

  const conflict = (message: string) => (error: EmmettError) =>
    error instanceof EmmettError &&
    error.errorCode === 409 &&
    error.message === message;

  describe('adding a product item', () => {
    it('opens a cart when one does not exist', () =>
      given([])
        .when(addProductItem(productItem))
        .then([
          {
            type: 'ShoppingCartOpened',
            data: { shoppingCartId, clientId, openedAt: now },
            metadata,
          },
          {
            type: 'ProductItemAddedToShoppingCart',
            data: { shoppingCartId, clientId, productItem, addedAt: now },
            metadata,
          },
        ]));

    it('adds a new product line to an opened cart', () =>
      given([opened, added()])
        .when(
          addProductItem({
            productId: 'product-2',
            quantity: 1,
            unitPrice: 2_000,
          }),
        )
        .then([
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem: {
                productId: 'product-2',
                quantity: 1,
                unitPrice: 2_000,
              },
              addedAt: now,
            },
            metadata,
          },
        ]));

    it('keeps the captured price when adding an existing product', () =>
      given([opened, added()])
        .when(
          addProductItem({
            productId: 'product-1',
            quantity: 3,
            unitPrice: 2_000,
          }),
        )
        .then([
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem: {
                productId: 'product-1',
                quantity: 3,
                unitPrice: 1_500,
              },
              addedAt: now,
            },
            metadata,
          },
        ]));

    it('rejects adding a product to a confirmed cart', () =>
      given([opened, added(), confirmed])
        .when(addProductItem(productItem))
        .thenThrows(conflict('Shopping Cart already closed')));

    it('rejects adding a product to a cancelled cart', () =>
      given([opened, added(), cancelled])
        .when(addProductItem(productItem))
        .thenThrows(conflict('Shopping Cart already closed')));
  });

  describe('removing a product item', () => {
    it('removes the product with its captured price', () =>
      given([opened, added()])
        .when(removeProductItem('product-1', 1))
        .then([
          {
            type: 'ProductItemRemovedFromShoppingCart',
            data: {
              shoppingCartId,
              productItem: {
                productId: 'product-1',
                quantity: 1,
                unitPrice: 1_500,
              },
              removedAt: now,
            },
            metadata,
          },
        ]));

    it('rejects removing a missing product', () =>
      given([opened, added()])
        .when(removeProductItem('product-2', 1))
        .thenThrows(conflict('Not enough products in shopping cart')));

    it('rejects removing more than the cart holds', () =>
      given([opened, added()])
        .when(removeProductItem('product-1', 3))
        .thenThrows(conflict('Not enough products in shopping cart')));

    it('rejects removing a product when the cart does not exist', () =>
      given([])
        .when(removeProductItem('product-1', 1))
        .thenThrows(conflict('Shopping Cart is not opened')));

    it('rejects removing a product from a confirmed cart', () =>
      given([opened, added(), confirmed])
        .when(removeProductItem('product-1', 1))
        .thenThrows(conflict('Shopping Cart is not opened')));

    it('rejects removing a product from a cancelled cart', () =>
      given([opened, added(), cancelled])
        .when(removeProductItem('product-1', 1))
        .thenThrows(conflict('Shopping Cart is not opened')));
  });

  describe('confirming a cart', () => {
    it('confirms a non-empty opened cart', () =>
      given([opened, added()])
        .when(confirm)
        .then([
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: now },
            metadata,
          },
        ]));

    it('does nothing when the cart is already confirmed', () =>
      given([opened, added(), confirmed]).when(confirm).thenNothingHappened());

    it('rejects confirming a missing cart', () =>
      given([])
        .when(confirm)
        .thenThrows(conflict('Shopping Cart is not opened')));

    it('rejects confirming a cancelled cart', () =>
      given([opened, added(), cancelled])
        .when(confirm)
        .thenThrows(conflict('Shopping Cart is not opened')));

    it('rejects confirming an empty cart', () =>
      given([opened, added(), removed()])
        .when(confirm)
        .thenThrows(conflict('Shopping Cart is empty')));
  });

  describe('cancelling a cart', () => {
    it('cancels an opened cart', () =>
      given([opened, added()])
        .when(cancel)
        .then([
          {
            type: 'ShoppingCartCancelled',
            data: { shoppingCartId, cancelledAt: now },
            metadata,
          },
        ]));

    it('does nothing when the cart is already cancelled', () =>
      given([opened, added(), cancelled]).when(cancel).thenNothingHappened());

    it('rejects cancelling a missing cart', () =>
      given([])
        .when(cancel)
        .thenThrows(conflict('Shopping Cart is not opened')));

    it('rejects cancelling a confirmed cart', () =>
      given([opened, added(), confirmed])
        .when(cancel)
        .thenThrows(conflict('Shopping Cart is not opened')));
  });
});
