import {
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  ShoppingCartEvent as ShoppingCartEventDefinitions,
} from '../styles/a-builtin/shoppingCart';

// Type-only union of the per-event aliases
export type ShoppingCartEventByName =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

// Union derived from the runtime union definition
export type ShoppingCartEventDerived = typeof ShoppingCartEventDefinitions.Type;

export const narrow = (event: ShoppingCartEventByName) => {
  if (ShoppingCartConfirmed.is(event)) return event.data.confirmedAt;
  return undefined;
};
