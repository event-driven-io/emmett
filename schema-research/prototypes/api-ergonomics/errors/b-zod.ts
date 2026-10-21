import { ShoppingCartConfirmed, type ShoppingCartEvent } from '../styles/b-zod/shoppingCart';
// 1. wrong field type
export const e1 = ShoppingCartConfirmed({ shoppingCartId: 1, confirmedAt: new Date() }, { clientId: 'c' });
// 2. missing field
export const e2 = ShoppingCartConfirmed({ shoppingCartId: '1' }, { clientId: 'c' });
// 3. missing metadata
export const e3 = ShoppingCartConfirmed({ shoppingCartId: '1', confirmedAt: new Date() });
// 4. typo in switch
export const f4 = (e: ShoppingCartEvent) => { switch (e.type) { case 'ShoppingCartConfirmd': return 1; } return 0; };
import { z } from 'zod';
import { Event } from '../lib';
// 5. example value instead of a schema
export const e5 = Event('ShoppingCartOpened', { data: z.object({ shoppingCartId: '' }) });
