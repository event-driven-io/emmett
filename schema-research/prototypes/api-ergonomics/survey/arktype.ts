import { scope, type } from 'arktype';
import { assert, type Equals } from './_assert';

const Confirmed = type({ type: "'Confirmed'", cartId: 'string', at: 'string.date.iso.parse' });
type Confirmed = typeof Confirmed.infer;
assert<Equals<Confirmed, { type: 'Confirmed'; cartId: string; at: Date }>>();
type ConfirmedIn = typeof Confirmed.inferIn;
assert<Equals<ConfirmedIn, { type: 'Confirmed'; cartId: string; at: string }>>();
const Cancelled = type({ type: "'Cancelled'", cartId: 'string' });
const CartEvent = Confirmed.or(Cancelled);
type CartEvent = typeof CartEvent.infer;
assert<Equals<CartEvent['type'], 'Confirmed' | 'Cancelled'>>();

// scopes: names inside strings, one export for many types
const cart = scope({
  Item: { productId: 'string', quantity: 'number' },
  Added: { type: "'Added'", item: 'Item' },
  Removed: { type: "'Removed'", item: 'Item' },
  CartEvent: 'Added | Removed',
}).export();
type CartEvent2 = typeof cart.CartEvent.infer;
assert<Equals<CartEvent2['type'], 'Added' | 'Removed'>>();
