import { command, event, message, type Command, type Event } from '@event-driven-io/emmett';
import { assertType, type D1, type D2, type Equals, type Meta } from './domain';

const productItem = { productId: 'p', quantity: 1 };
type V1m = Event<'ProductItemAdded', D1, Meta>;
type UserMetaString = { meta: string; schemaVersion?: string };
type V1s = Event<'ProductItemAdded', D1, UserMetaString>;
type V2s = Event<'ProductItemAdded', D2, UserMetaString, 2>;
type UserMetaNumber = { meta: string; schemaVersion: number };
type V2n = Event<'ProductItemAdded', D2, UserMetaNumber, 2>;
type C1s = Command<'AddProductItem', D1, UserMetaString>;

// rejected
const wide: Meta & { schemaVersion: number } = { tenant: 't', schemaVersion: 2 };
// @ts-expect-error wide variable for V1m
event<V1m>('ProductItemAdded', { productId: 'p' }, wide);
const wideNow = { now: new Date(), schemaVersion: 2 };
// @ts-expect-error wide variable for an unversioned command
command<Command<'AddProductItem', D1>>('AddProductItem', { productId: 'p' }, wideNow);
// @ts-expect-error user string schemaVersion for V1s
event<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm', schemaVersion: '2' });
// @ts-expect-error user string schemaVersion for a command
command<C1s>('AddProductItem', { productId: 'p' }, { meta: 'm', schemaVersion: '2' });
// @ts-expect-error a string version for V2s
event<V2s>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: '2' });

// accepted
const s1 = event<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm' });
const s2 = event<V2s>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });
const s3 = event<V2n>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });
const s4 = command<C1s>('AddProductItem', { productId: 'p' }, { meta: 'm' });
const s5 = message<V2s>('Event', 'ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });

// result metadata types exclude schemaVersion
assertType<Equals<(typeof s1)['metadata'], Omit<UserMetaString, 'schemaVersion'>>>();
assertType<Equals<'schemaVersion' extends keyof (typeof s2)['metadata'] ? true : false, false>>();
assertType<Equals<(typeof s2)['schemaVersion'], 2>>();
assertType<Equals<'schemaVersion' extends keyof (typeof s3)['metadata'] ? true : false, false>>();
assertType<Equals<'schemaVersion' extends keyof (typeof s4)['metadata'] ? true : false, false>>();
assertType<Equals<'schemaVersion' extends keyof (typeof s5)['metadata'] ? true : false, false>>();
assertType<Equals<(typeof s2)['data'], D2>>();
assertType<Equals<(typeof s2)['type'], 'ProductItemAdded'>>();
assertType<Equals<(typeof s2)['kind'], 'Event' | undefined>>();

// the rewritten result is still assignable to V2s, because the user key is optional
export const asV2s: V2s = s2;

export { s1, s2, s3, s4, s5 };
// with a required user key, the result is not assignable to the declared type
// @ts-expect-error metadata.schemaVersion is missing in the result type
export const asV2n: V2n = s3;
