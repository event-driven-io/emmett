import { Event, s } from '../lib';

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: { clientId: s.string() },
});

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: { shoppingCartId: s.string(), cancelledAt: s.date() },
  metadata: { clientId: s.string() },
});
