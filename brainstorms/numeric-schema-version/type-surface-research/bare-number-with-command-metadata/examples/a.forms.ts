import { command, event, message, type Command, type Event } from '@event-driven-io/emmett';
import { assertType, type C1, type C2, type C3, type D1, type D2, type Equals, type Meta, type V1, type V2, type V2m } from './domain';

const productItem = { productId: 'p', quantity: 1 };
const now = new Date();
const metadata: Meta = { tenant: 't' };
type C2m = Command<'AddProductItem', D2, Meta, 2>;
type V1m = Event<'ProductItemAdded', D1, Meta>;
type V1x = Event<'ProductItemAdded', D1, undefined, 1>;
const maybeNow: { now: Date } | undefined = Math.random() > 0.5 ? { now } : undefined;

// commands: accepted
export const c1 = command<C2>('AddProductItem', { productItem }, 2);
export const c2 = command<C2>('AddProductItem', { productItem }, { now }, 2);
export const c3 = command<C2>('AddProductItem', { productItem }, undefined, 2);
export const c4 = command<C2>('AddProductItem', { productItem }, maybeNow, 2);
export const c5 = command<C3>('AddProductItem', { productItem }, { now }, 3);
export const c6 = command<C2m>('AddProductItem', { productItem }, metadata, 2);
export const c7 = command<C1>('AddProductItem', { productId: 'p' });
export const c8 = command<C1>('AddProductItem', { productId: 'p' }, { now });
export const c9 = command<C1>('AddProductItem', { productId: 'p' }, undefined);
assertType<Equals<typeof c2, C2>>();

// commands: rejected
// @ts-expect-error r1: no version
command<C2>('AddProductItem', { productItem });
// @ts-expect-error r2: { now } without a version
command<C2>('AddProductItem', { productItem }, { now });
// @ts-expect-error r3: version before { now }
command<C2>('AddProductItem', { productItem }, 2, { now });
// @ts-expect-error r4: wrong literal, short form
command<C2>('AddProductItem', { productItem }, 3);
// @ts-expect-error r5: wrong literal, long form
command<C2>('AddProductItem', { productItem }, { now }, 3);
// @ts-expect-error r6: undefined without a version
command<C2>('AddProductItem', { productItem }, undefined);
// @ts-expect-error r7: declared metadata without a version
command<C2m>('AddProductItem', { productItem }, metadata);
// @ts-expect-error r8: declared metadata replaced by undefined
command<C2m>('AddProductItem', { productItem }, undefined, 2);
// @ts-expect-error r9: declared metadata left out
command<C2m>('AddProductItem', { productItem }, 2);
// @ts-expect-error r10: version on an unversioned command, short form
command<C1>('AddProductItem', { productId: 'p' }, 1);
// @ts-expect-error r11: version on an unversioned command, long form
command<C1>('AddProductItem', { productId: 'p' }, { now }, 1);
// @ts-expect-error r12: other metadata than { now }
command<C2>('AddProductItem', { productItem }, { tenant: 't' }, 2);

// events: accepted
export const e1 = event<V2>('ProductItemAdded', { productItem }, 2);
export const e2 = event<V2m>('ProductItemAdded', { productItem }, metadata, 2);
export const e3 = event<V1>('ProductItemAdded', { productId: 'p' });
export const e4 = event<V1m>('ProductItemAdded', { productId: 'p' }, metadata);
assertType<Equals<typeof e1, V2>>();
assertType<Equals<typeof e2, V2m>>();

// events: rejected
// @ts-expect-error r13: no version
event<V2>('ProductItemAdded', { productItem });
// @ts-expect-error r14: wrong literal
event<V2>('ProductItemAdded', { productItem }, 3);
// @ts-expect-error r15: metadata missing for V2m
event<V2m>('ProductItemAdded', { productItem }, 2);
// @ts-expect-error r16: version missing for V2m
event<V2m>('ProductItemAdded', { productItem }, metadata);
// @ts-expect-error r17: version on V1
event<V1>('ProductItemAdded', { productId: 'p' }, 1);
// @ts-expect-error r18: version on explicit version 1
event<V1x>('ProductItemAdded', { productId: 'p' }, 1);
// @ts-expect-error r19: the undefined form for an event without declared metadata
event<V2>('ProductItemAdded', { productItem }, undefined, 2);

// message()
export const m1 = message<V2>('Event', 'ProductItemAdded', { productItem }, 2);
export const m2 = message<C2>('Command', 'AddProductItem', { productItem }, 2);
export const m3 = message<V2m>('Event', 'ProductItemAdded', { productItem }, metadata, 2);
export const m4 = message<V1>('Event', 'ProductItemAdded', { productId: 'p' });
// @ts-expect-error r20: message V2 without version
message<V2>('Event', 'ProductItemAdded', { productItem });
// @ts-expect-error r21: message C2 with { now } (message() never took default command metadata)
message<C2>('Command', 'AddProductItem', { productItem }, { now }, 2);
