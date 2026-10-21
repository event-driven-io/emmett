import { ShoppingCartConfirmed } from '../styles/f-class/shoppingCart';
// 1. wrong field type
export const e1 = new ShoppingCartConfirmed({ shoppingCartId: 1, confirmedAt: new Date() }, { clientId: 'c' });
// 14. instanceof after a JSON round trip (compiles, but is false at runtime)
const roundTripped: unknown = JSON.parse(JSON.stringify(new ShoppingCartConfirmed({ shoppingCartId: '1', confirmedAt: new Date() }, { clientId: 'c' })));
console.log('instanceof after JSON round trip:', roundTripped instanceof ShoppingCartConfirmed);
