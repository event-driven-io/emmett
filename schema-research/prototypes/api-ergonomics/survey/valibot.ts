import * as v from 'valibot';
import { assert, type Equals } from './_assert';

const Confirmed = v.object({ type: v.literal('Confirmed'), cartId: v.string() });
type Confirmed = v.InferOutput<typeof Confirmed>;
assert<Equals<Confirmed, { type: 'Confirmed'; cartId: string }>>();
const Cancelled = v.object({ type: v.literal('Cancelled'), cartId: v.string() });
const CartEvent = v.variant('type', [Confirmed, Cancelled]);
type CartEvent = v.InferOutput<typeof CartEvent>;
assert<Equals<CartEvent['type'], 'Confirmed' | 'Cancelled'>>();
