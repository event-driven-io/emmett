import { command, event, message, type Command } from '@event-driven-io/emmett';
import {
  assertType,
  type C1,
  type C2,
  type D2,
  type Equals,
  type Meta,
  type V1,
  type V2,
  type V2m,
} from './domain';

const productItem = { productId: 'p', quantity: 1 };

const e2 = event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
assertType<Equals<typeof e2, V2>>();
assertType<Equals<(typeof e2)['schemaVersion'], 2>>();
assertType<Equals<'metadata' extends keyof typeof e2 ? true : false, false>>();

const e2m = event<V2m>('ProductItemAdded', { productItem }, { tenant: 't', schemaVersion: 2 });
assertType<Equals<typeof e2m, V2m>>();
assertType<Equals<(typeof e2m)['metadata'], Meta>>();
assertType<Equals<'schemaVersion' extends keyof (typeof e2m)['metadata'] ? true : false, false>>();

const c2 = command<C2>('AddProductItem', { productItem }, { now: new Date(), schemaVersion: 2 });
assertType<Equals<typeof c2, C2>>();
assertType<Equals<(typeof c2)['schemaVersion'], 2>>();
type C2m = Command<'AddProductItem', D2, Meta, 2>;
const c2m = command<C2m>('AddProductItem', { productItem }, { tenant: 't', schemaVersion: 2 });
assertType<Equals<(typeof c2m)['metadata'], Meta>>();

const m2 = message<V2>('Event', 'ProductItemAdded', { productItem }, { schemaVersion: 2 });
assertType<Equals<typeof m2, V2>>();

const e1 = event<V1>('ProductItemAdded', { productId: 'p' });
assertType<Equals<typeof e1, V1>>();
assertType<Equals<(typeof e1)['schemaVersion'], 1 | undefined>>();
const c1 = command<C1>('AddProductItem', { productId: 'p' });
assertType<Equals<typeof c1, C1>>();

export { e2, e2m, c2, c2m, m2, e1, c1 };
