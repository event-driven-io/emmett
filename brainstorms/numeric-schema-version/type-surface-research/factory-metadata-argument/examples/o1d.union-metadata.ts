import { command, event, type Command, type Event } from '@event-driven-io/emmett';
import { assertType, type D1, type D2, type Equals } from './domain';

const productItem = { productId: 'p', quantity: 1 };
type Web = { source: 'web'; ip: string };
type Batch = { source: 'batch'; batchId: string };
type Meta = Web | Batch;

type V1u = Event<'ProductItemAdded', D1, Meta>;
type V2u = Event<'ProductItemAdded', D2, Meta, 2>;
type C1u = Command<'AddProductItem', D1, Meta>;

// what Omit does to the union
assertType<Equals<Omit<Meta, 'schemaVersion'>, { source: 'web' | 'batch' }>>();
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
assertType<Equals<DistributiveOmit<Meta, 'schemaVersion'>, Omit<Web, 'schemaVersion'> | Omit<Batch, 'schemaVersion'>>>();

// u1: unversioned with union metadata (compiles today)
export const u1 = event<V1u>('ProductItemAdded', { productId: 'p' }, { source: 'web', ip: '1.2.3.4' });
const webVariable: Meta = { source: 'batch', batchId: 'b' };
export const u1b = event<V1u>('ProductItemAdded', { productId: 'p' }, webVariable);
export const u1c = command<C1u>('AddProductItem', { productId: 'p' }, { source: 'batch', batchId: 'b' });
// u2: versioned with union metadata
export const u2 = event<V2u>('ProductItemAdded', { productItem }, { source: 'web', ip: '1.2.3.4', schemaVersion: 2 });
// u3: the result's metadata keeps the union
assertType<Equals<(typeof u1)['metadata'], Meta>>();
assertType<Equals<(typeof u2)['metadata'], Meta>>();

// u4: union metadata where every member declares schemaVersion
type WebV = Web & { schemaVersion?: string };
type BatchV = Batch & { schemaVersion?: string };
type V1uv = Event<'ProductItemAdded', D1, WebV | BatchV>;
export const u4 = event<V1uv>('ProductItemAdded', { productId: 'p' }, { source: 'web', ip: '1.2.3.4' });
export const u4check = (e: typeof u4) => (e.metadata.source === 'web' ? e.metadata.ip : e.metadata.batchId);
assertType<Equals<(typeof u4)['metadata'], Omit<WebV, 'schemaVersion'> | Omit<BatchV, 'schemaVersion'>>>();

// rejections that must still hold with union metadata
// @ts-expect-error a version for an unversioned type with union metadata
event<V1u>('ProductItemAdded', { productId: 'p' }, { source: 'web', ip: '1', schemaVersion: 1 });
// @ts-expect-error a versioned type with union metadata needs the version
event<V2u>('ProductItemAdded', { productItem }, { source: 'web', ip: '1' });
// @ts-expect-error a member mix-up is still rejected
event<V1u>('ProductItemAdded', { productId: 'p' }, { source: 'web', batchId: 'b' });
