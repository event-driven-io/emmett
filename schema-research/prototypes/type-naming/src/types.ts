type Event<T extends string, D, M = undefined> = Readonly<{ type: T; data: D; metadata?: M }>;

export type ShoppingCartEventMetadata = { clientId: string };

/** Shopper confirmed the cart */
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { shoppingCartId: string; cancelledAt: Date },
  ShoppingCartEventMetadata
>;
export type ShoppingCartEvent = ShoppingCartConfirmed | ShoppingCartCancelled;
