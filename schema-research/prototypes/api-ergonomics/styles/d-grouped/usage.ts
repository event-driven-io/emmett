import {
  DeciderCommandHandler,
  getInMemoryEventStore,
  projection,
  projections,
} from '@event-driven-io/emmett';
import { decider, ShoppingCartCommand } from './businessLogic';
import { ShoppingCartEvent } from './shoppingCart';

export const totals = projection<ShoppingCartEvent>({
  canHandle: ShoppingCartEvent.types,
  handle: (events) => {
    for (const { type } of events) console.log('projected', type);
  },
});

const handle = DeciderCommandHandler(decider);
const eventStore = getInMemoryEventStore({
  projections: projections.inline([totals]),
});

// Runtime schema: the HTTP body is validated, and ISO strings become Dates.
const body: unknown = JSON.parse(
  '{"type":"AddProductItemToShoppingCart","data":{"clientId":"c1","shoppingCartId":"cart-1","productItem":{"productId":"p1","quantity":2,"unitPrice":10}},"metadata":{"clientId":"c1","now":"2026-10-04T10:00:00.000Z"}}',
);
const result =
  await ShoppingCartCommand.AddProductItemToShoppingCart.validate(body);
if (result.issues) throw new Error(JSON.stringify(result.issues));
console.log('now is a Date?', result.value.metadata.now instanceof Date);

const invalid = await ShoppingCartCommand.validate({
  type: 'AddProductItemToShoppingCart',
  data: { clientId: 'c1', shoppingCartId: 42 },
  metadata: { clientId: 'c1', now: 'yesterday' },
});
console.log('issues', JSON.stringify(invalid.issues));

const add = ShoppingCartCommand.AddProductItemToShoppingCart(
  result.value.data,
  result.value.metadata,
);
const { newEvents } = await handle(eventStore, 'cart-1', add);
console.log(JSON.stringify(newEvents));
