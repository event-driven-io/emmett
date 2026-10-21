import { event } from '@event-driven-io/emmett';
import type { ShoppingCartConfirmed, ShoppingCartEvent } from '../styles/today/shoppingCart';
// 1. wrong field type
export const e1: ShoppingCartConfirmed = { type: 'ShoppingCartConfirmed', data: { shoppingCartId: 1, confirmedAt: new Date() }, metadata: { clientId: 'c' } };
// 2. missing field
export const e2 = event<ShoppingCartConfirmed>('ShoppingCartConfirmed', { shoppingCartId: '1' }, { clientId: 'c' });
// 3. missing metadata
export const e3 = event<ShoppingCartConfirmed>('ShoppingCartConfirmed', { shoppingCartId: '1', confirmedAt: new Date() });
// 4. typo in switch
export const f4 = (e: ShoppingCartEvent) => { switch (e.type) { case 'ShoppingCartConfirmd': return 1; } return 0; };
