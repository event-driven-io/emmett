import Type, { type Static } from 'typebox';
import { assert, type Equals } from './_assert';

const Confirmed = Type.Object({ type: Type.Literal('Confirmed'), cartId: Type.String() });
type Confirmed = Static<typeof Confirmed>;
assert<Equals<Confirmed, { type: 'Confirmed'; cartId: string }>>();
const CartEvent = Type.Union([Confirmed, Type.Object({ type: Type.Literal('Cancelled') })]);
type CartEvent = Static<typeof CartEvent>;
assert<Equals<CartEvent['type'], 'Confirmed' | 'Cancelled'>>();
