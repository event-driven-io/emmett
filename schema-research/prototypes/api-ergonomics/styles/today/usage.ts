import {
  command,
  DeciderCommandHandler,
  getInMemoryEventStore,
  projection,
  projections,
} from '@event-driven-io/emmett';
import { decider, type AddProductItemToShoppingCart } from './businessLogic';
import type { ShoppingCartEvent } from './shoppingCart';

export const totals = projection<ShoppingCartEvent>({
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  handle: (events) => {
    for (const { type } of events) console.log('projected', type);
  },
});

const handle = DeciderCommandHandler(decider);
const eventStore = getInMemoryEventStore({
  projections: projections.inline([totals]),
});

// No runtime schema: an HTTP body is cast, and dates stay strings unless parsed by hand.
const body: unknown = JSON.parse(
  '{"type":"AddProductItemToShoppingCart","data":{"clientId":"c1","shoppingCartId":"cart-1","productItem":{"productId":"p1","quantity":2,"unitPrice":10}},"metadata":{"clientId":"c1","now":"2026-10-04T10:00:00.000Z"}}',
);
const fromHttp = body as AddProductItemToShoppingCart;
console.log('now is a Date?', fromHttp.metadata.now instanceof Date);

const add = command<AddProductItemToShoppingCart>(
  'AddProductItemToShoppingCart',
  fromHttp.data,
  { clientId: 'c1', now: new Date('2026-10-04T10:00:00.000Z') },
);
const { newEvents } = await handle(eventStore, 'cart-1', add);
console.log(JSON.stringify(newEvents));
