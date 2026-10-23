import * as shoppingCartEvents from './per-module-defs';

type TypesOf<M> = {
  [K in keyof M as M[K] extends { readonly Type: unknown } ? K : never]: M[K] extends { readonly Type: infer T } ? T : never;
};

// One typeof for the whole file of definitions
export type ShoppingCartEvents = TypesOf<typeof shoppingCartEvents>;
export type ShoppingCartEvent = ShoppingCartEvents[keyof ShoppingCartEvents];

// Optional short names, no typeof
export type ShoppingCartConfirmed = ShoppingCartEvents['ShoppingCartConfirmed'];

export const evolve = (state: string, event: ShoppingCartEvent): string => {
  switch (event.type) {
    case 'ShoppingCartConfirmed':
      return `confirmed at ${event.data.confirmedAt.toISOString()}`;
    case 'ShoppingCartCancelled':
      return `cancelled at ${event.data.cancelledAt.toISOString()}`;
  }
};

export const confirmedId = (e: ShoppingCartConfirmed) => e.data.shoppingCartId;
