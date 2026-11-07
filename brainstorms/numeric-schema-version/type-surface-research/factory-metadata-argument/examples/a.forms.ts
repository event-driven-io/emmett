import { command, event, message, type Command, type Event } from '@event-driven-io/emmett';
import type { C1, C2, D1, D2, Meta, V1, V2, V2m } from './domain';

const productItem = { productId: 'p', quantity: 1 };
const now = new Date();
const metadata: Meta = { tenant: 't' };
type C2m = Command<'AddProductItem', D2, Meta, 2>;
type M2 = V2;

// Accepted forms
export const f1 = event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
export const f2 = event<V2m>('ProductItemAdded', { productItem }, { ...metadata, schemaVersion: 2 });
export const f3 = command<C2>('AddProductItem', { productItem }, { schemaVersion: 2 });
export const f4 = command<C2>('AddProductItem', { productItem }, { now, schemaVersion: 2 });
export const f5 = command<C2m>('AddProductItem', { productItem }, { ...metadata, schemaVersion: 2 });
export const f6 = message<M2>('Event', 'ProductItemAdded', { productItem }, { schemaVersion: 2 });
export const f6b = message<C2>('Command', 'AddProductItem', { productItem }, { schemaVersion: 2 });
export const f6c = message<V2m>('Event', 'ProductItemAdded', { productItem }, { tenant: 't', schemaVersion: 2 });

// Unversioned forms stay as today
export const u1 = event<V1>('ProductItemAdded', { productId: 'p' });
type V1m = Event<'ProductItemAdded', D1, Meta>;
export const u2 = event<V1m>('ProductItemAdded', { productId: 'p' }, metadata);
export const u3 = command<C1>('AddProductItem', { productId: 'p' });
export const u4 = command<C1>('AddProductItem', { productId: 'p' }, { now });
export const u5 = message<V1>('Event', 'ProductItemAdded', { productId: 'p' });

// Rejected forms
// @ts-expect-error r1: V2 without the argument
event<V2>('ProductItemAdded', { productItem });
// @ts-expect-error r2: V2 argument without schemaVersion
event<V2>('ProductItemAdded', { productItem }, {});
// @ts-expect-error r3: wrong literal
event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 3 });
// @ts-expect-error r4: V2m without its declared metadata fields
event<V2m>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
// @ts-expect-error r4b: V2m with metadata but no schemaVersion
event<V2m>('ProductItemAdded', { productItem }, metadata);
// @ts-expect-error r5: schemaVersion inline for V1 without metadata
event<V1>('ProductItemAdded', { productId: 'p' }, { schemaVersion: 1 });
// @ts-expect-error r5b: schemaVersion inline for V1 with metadata
event<V1m>('ProductItemAdded', { productId: 'p' }, { ...metadata, schemaVersion: 1 });
type V1x = Event<'ProductItemAdded', D1, undefined, 1>;
// @ts-expect-error r6: schemaVersion inline for explicit version 1
event<V1x>('ProductItemAdded', { productId: 'p' }, { schemaVersion: 1 });
// @ts-expect-error r7: schemaVersion inline for an unversioned command
command<C1>('AddProductItem', { productId: 'p' }, { now, schemaVersion: 1 });
// @ts-expect-error r7b: only schemaVersion for an unversioned command
command<C1>('AddProductItem', { productId: 'p' }, { schemaVersion: 1 });
// @ts-expect-error r8: C2 without the argument
command<C2>('AddProductItem', { productItem });
// @ts-expect-error r8b: C2 with now but no schemaVersion
command<C2>('AddProductItem', { productItem }, { now });
// @ts-expect-error r9: C2m without its declared metadata fields
command<C2m>('AddProductItem', { productItem }, { schemaVersion: 2 });
// @ts-expect-error r10: message V2 without the argument
message<M2>('Event', 'ProductItemAdded', { productItem });
// @ts-expect-error r11: message V1 with schemaVersion
message<V1>('Event', 'ProductItemAdded', { productId: 'p' }, { schemaVersion: 1 });
// @ts-expect-error r12: bare number no longer accepted
event<V2>('ProductItemAdded', { productItem }, 2);
