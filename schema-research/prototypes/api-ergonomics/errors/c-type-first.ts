import { Event, s } from '../lib';
import { ShoppingCartConfirmed, ShoppingCartEventMetadata } from '../styles/c-type-first/shoppingCart';
// 1. wrong field type
export const e1 = ShoppingCartConfirmed({ shoppingCartId: 1, confirmedAt: new Date() }, { clientId: 'c' });
// 6. schema disagrees with the declared type (string instead of Date)
export const d6 = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.string() },
  metadata: ShoppingCartEventMetadata,
});
// 7. schema misses a field
export const d7 = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string() },
  metadata: ShoppingCartEventMetadata,
});
// 8. schema has an extra field
export const d8 = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date(), extra: s.string() },
  metadata: ShoppingCartEventMetadata,
});
// 9. wrong type name
export const d9 = Event<ShoppingCartConfirmed>('ShoppingCartConfirmd', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
// 10. forgot metadata schema
export const d10 = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
});
