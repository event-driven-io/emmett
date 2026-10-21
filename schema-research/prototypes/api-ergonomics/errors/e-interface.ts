import { ShoppingCartConfirmed, type ShoppingCartEvent } from '../styles/e-interface/shoppingCart';
// 1. wrong field type
export const e1 = ShoppingCartConfirmed({ shoppingCartId: 1, confirmedAt: new Date() }, { clientId: 'c' });
// 4. typo in switch
export const f4 = (e: ShoppingCartEvent) => { switch (e.type) { case 'ShoppingCartConfirmd': return 1; } return 0; };
// 12. returning the wrong event from a function annotated with an interface type
export const f12 = (): ShoppingCartConfirmed => ({ type: 'ShoppingCartCancelled', data: { shoppingCartId: '1', cancelledAt: new Date() }, metadata: { clientId: 'c' } });
