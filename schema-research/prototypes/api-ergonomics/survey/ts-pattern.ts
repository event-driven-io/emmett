import { isMatching, match, P } from 'ts-pattern';
import { assert, type Equals } from './_assert';

const confirmedPattern = { type: 'Confirmed', cartId: P.string } as const;
type Confirmed = P.infer<typeof confirmedPattern>;
assert<Equals<Confirmed, { type: 'Confirmed'; cartId: string }>>();
type CartEvent = Confirmed | { type: 'Cancelled'; cartId: string };
export const describe = (e: CartEvent) =>
  match(e)
    .with({ type: 'Confirmed' }, (c) => c.cartId)
    .with({ type: 'Cancelled' }, (c) => c.cartId)
    .exhaustive();
export const guard = (u: unknown) => isMatching(confirmedPattern, u);
