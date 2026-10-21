import { z } from 'zod';
import { assert, type Equals } from './_assert';

const Confirmed = z.object({ type: z.literal('Confirmed'), cartId: z.string() });
type Confirmed = z.infer<typeof Confirmed>;
assert<Equals<Confirmed, { type: 'Confirmed'; cartId: string }>>();
const Cancelled = z.object({ type: z.literal('Cancelled'), cartId: z.string() });
const CartEvent = z.discriminatedUnion('type', [Confirmed, Cancelled]);
type CartEvent = z.infer<typeof CartEvent>;
assert<Equals<CartEvent, Confirmed | { type: 'Cancelled'; cartId: string }>>();
export const option = z.getDiscriminatedOption(CartEvent, 'Confirmed');
