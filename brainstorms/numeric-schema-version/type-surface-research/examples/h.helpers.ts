import { command, event, message, type Command, type Event } from '@event-driven-io/emmett';
import {
  assertType,
  type C1,
  type C2,
  type C3,
  type D2,
  type Equals,
  type Meta,
  type V1,
  type V2,
  type V2m,
} from './domain';

const productItem = { productId: 'p', quantity: 1 };

// 2.1: version required
// @ts-expect-error version missing
event<V2>('ProductItemAdded', { productItem });
// 2.2
const e2 = event<V2>('ProductItemAdded', { productItem }, 2);
assertType<Equals<typeof e2, V2>>();
// wrong literal
// @ts-expect-error wrong version
event<V2>('ProductItemAdded', { productItem }, 3);
// 2.3
const e2m = event<V2m>('ProductItemAdded', { productItem }, { tenant: 't' }, 2);
// @ts-expect-error version missing with metadata
event<V2m>('ProductItemAdded', { productItem }, { tenant: 't' });
// 2.4: no version accepted for unversioned
event<V1>('ProductItemAdded', { productId: 'p' });
// @ts-expect-error version not accepted for V1
event<V1>('ProductItemAdded', { productId: 'p' }, 1);
// explicit Event<..., 1>
type V1x = Event<'ProductItemAdded', { productId: string }, undefined, 1>;
// @ts-expect-error version not accepted for explicit 1
event<V1x>('ProductItemAdded', { productId: 'p' }, 1);
// generic name Event<string, D>
type Gen = Event<string, { productId: string }>;
event<Gen>('Anything', { productId: 'p' });
// @ts-expect-error number version is not declared, so not accepted
event<Gen>('Anything', { productId: 'p' }, 5);

// 2.5 commands
const c2 = command<C2>('AddProductItem', { productItem }, 2);
assertType<Equals<typeof c2, C2>>();
// @ts-expect-error version missing
command<C2>('AddProductItem', { productItem });
command<C3>('AddProductItem', { productItem }, 3);
// h: default metadata on unversioned command still accepted
command<C1>('AddProductItem', { productId: 'p' }, { now: new Date() });
// h1: default metadata plus version on versioned command without declared metadata
// @ts-expect-error h1 is rejected by the agreed tuple
command<C2>('AddProductItem', { productItem }, { now: new Date() }, 2);
// h2: version first, then metadata
// @ts-expect-error h2 is rejected by the agreed tuple
command<C2>('AddProductItem', { productItem }, 2, { now: new Date() });
// versioned command with declared metadata
type C2m = Command<'AddProductItem', D2, Meta, 2>;
command<C2m>('AddProductItem', { productItem }, { tenant: 't' }, 2);

// 2.6 messages
const m2 = message<V2>('Event', 'ProductItemAdded', { productItem }, 2);
assertType<Equals<typeof m2, V2>>();
message<C2>('Command', 'AddProductItem', { productItem }, 2);
// @ts-expect-error version missing
message<V2>('Event', 'ProductItemAdded', { productItem });
message<V2m>('Event', 'ProductItemAdded', { productItem }, { tenant: 't' }, 2);
message<V1>('Event', 'ProductItemAdded', { productId: 'p' });

// unions passed as the type argument
type U = V1 | V2;
export const u1 = (): U => event<U>('ProductItemAdded', { productId: 'p' });

export { e2m };
