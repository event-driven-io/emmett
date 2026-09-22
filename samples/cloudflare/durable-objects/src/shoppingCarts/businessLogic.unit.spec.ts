import { DeciderSpecification, EmmettError } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { decider, type ShoppingCartCommand } from './businessLogic';
import type { PricedProductItem, ShoppingCartEvent } from './shoppingCart';

const given = DeciderSpecification.for(decider);

describe('ShoppingCart', () => {
  const clientId = 'client-1';
  const shoppingCartId = `shopping_cart-${clientId}:1`;
  const metadata = { clientId };
  const openedAt = new Date('2026-09-13T10:00:00.000Z');
  const now = new Date('2026-09-13T11:00:00.000Z');

  const shoes: PricedProductItem = {
    productId: 'product-1',
    quantity: 2,
    unitPrice: 1_500,
  };

  const opened: ShoppingCartEvent = {
    type: 'ShoppingCartOpened',
    data: { shoppingCartId, clientId, openedAt },
    metadata,
  };

  const shoesAdded: ShoppingCartEvent = {
    type: 'ProductItemAddedToShoppingCart',
    data: { shoppingCartId, clientId, productItem: shoes, addedAt: openedAt },
    metadata,
  };

  const shoesRemoved: ShoppingCartEvent = {
    type: 'ProductItemRemovedFromShoppingCart',
    data: { shoppingCartId, productItem: shoes, removedAt: openedAt },
    metadata,
  };

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

  const addProductItem = (
    productItem: PricedProductItem,
  ): ShoppingCartCommand => ({
    type: 'AddProductItemToShoppingCart',
    data: { shoppingCartId, clientId, productItem },
    metadata: { clientId, now },
  });

  const removeProductItem = (
    productId: string,
    quantity: number,
  ): ShoppingCartCommand => ({
    type: 'RemoveProductItemFromShoppingCart',
    data: { shoppingCartId, productId, quantity },
    metadata: { clientId, now },
  });

  const confirm: ShoppingCartCommand = {
    type: 'ConfirmShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now },
  };

  const cancel: ShoppingCartCommand = {
    type: 'CancelShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now },
  };

  const conflict = (message: string) => (error: EmmettError) =>
    error.errorCode === 409 && error.message === message;

  describe('adding a product item', () => {
    it('opens a cart when one does not exist', () =>
      given([])
        .when(addProductItem(shoes))
        .then([
          {
            type: 'ShoppingCartOpened',
            data: { shoppingCartId, clientId, openedAt: now },
            metadata,
          },
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem: shoes,
              addedAt: now,
            },
            metadata,
          },
        ]));

    it('adds a new product to an opened cart', () => {
      const productItem = {
        productId: 'product-2',
        quantity: 1,
        unitPrice: 2_000,
      };

      return given([opened, shoesAdded])
        .when(addProductItem(productItem))
        .then([
          {
            type: 'ProductItemAddedToShoppingCart',
            data: { shoppingCartId, clientId, productItem, addedAt: now },
            metadata,
          },
        ]);
    });

    it('keeps the first unit price when adding an existing product', () =>
      given([opened, shoesAdded])
        .when(addProductItem({ ...shoes, quantity: 3, unitPrice: 2_000 }))
        .then([
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem: { ...shoes, quantity: 3 },
              addedAt: now,
            },
            metadata,
          },
        ]));

    it('rejects adding a product to a confirmed cart', () =>
      given([opened, shoesAdded, confirmed])
        .when(addProductItem(shoes))
        .thenThrows(EmmettError, conflict('Shopping Cart already closed')));

    it('rejects adding a product to a cancelled cart', () =>
      given([opened, shoesAdded, cancelled])
        .when(addProductItem(shoes))
        .thenThrows(EmmettError, conflict('Shopping Cart already closed')));
  });

  describe('removing a product item', () => {
    it('removes the product quantity with its unit price', () =>
      given([opened, shoesAdded])
        .when(removeProductItem('product-1', 1))
        .then([
          {
            type: 'ProductItemRemovedFromShoppingCart',
            data: {
              shoppingCartId,
              productItem: { ...shoes, quantity: 1 },
              removedAt: now,
            },
            metadata,
          },
        ]));

    it('rejects removing a product when the cart does not exist', () =>
      given([])
        .when(removeProductItem('product-1', 1))
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects removing a product from a confirmed cart', () =>
      given([opened, shoesAdded, confirmed])
        .when(removeProductItem('product-1', 1))
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects removing a product from a cancelled cart', () =>
      given([opened, shoesAdded, cancelled])
        .when(removeProductItem('product-1', 1))
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects removing a product that is not in the cart', () =>
      given([opened, shoesAdded])
        .when(removeProductItem('product-2', 1))
        .thenThrows(
          EmmettError,
          conflict('Not enough products in shopping cart'),
        ));

    it('rejects removing more products than the cart has', () =>
      given([opened, shoesAdded])
        .when(removeProductItem('product-1', 3))
        .thenThrows(
          EmmettError,
          conflict('Not enough products in shopping cart'),
        ));
  });

  describe('confirming a cart', () => {
    it('confirms a non-empty opened cart', () =>
      given([opened, shoesAdded])
        .when(confirm)
        .then([
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: now },
            metadata,
          },
        ]));

    it('does nothing when the cart is already confirmed', () =>
      given([opened, shoesAdded, confirmed])
        .when(confirm)
        .thenNothingHappened());

    it('rejects confirming a cart that does not exist', () =>
      given([])
        .when(confirm)
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects confirming a cancelled cart', () =>
      given([opened, shoesAdded, cancelled])
        .when(confirm)
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects confirming an empty cart', () =>
      given([opened, shoesAdded, shoesRemoved])
        .when(confirm)
        .thenThrows(EmmettError, conflict('Shopping Cart is empty')));
  });

  describe('cancelling a cart', () => {
    it('cancels an opened cart', () =>
      given([opened, shoesAdded])
        .when(cancel)
        .then([
          {
            type: 'ShoppingCartCancelled',
            data: { shoppingCartId, cancelledAt: now },
            metadata,
          },
        ]));

    it('does nothing when the cart is already cancelled', () =>
      given([opened, shoesAdded, cancelled])
        .when(cancel)
        .thenNothingHappened());

    it('rejects cancelling a cart that does not exist', () =>
      given([])
        .when(cancel)
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));

    it('rejects cancelling a confirmed cart', () =>
      given([opened, shoesAdded, confirmed])
        .when(cancel)
        .thenThrows(EmmettError, conflict('Shopping Cart is not opened')));
  });
});
