import { ShoppingCartConfirmed, type ShoppingCartEvents } from '../styles/d-grouped/shoppingCart';
// 1. wrong field type
export const e1 = ShoppingCartConfirmed({ shoppingCartId: 1, confirmedAt: new Date() }, { clientId: 'c' });
// 11. typo in member lookup
export type T11 = ShoppingCartEvents['ShoppingCartConfirmd'];
