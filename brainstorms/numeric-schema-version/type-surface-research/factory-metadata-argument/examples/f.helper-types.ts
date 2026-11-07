import {
  command,
  event,
  type AnyEvent,
  type CreateEventType,
  type Event,
  type MessageSchemaVersionOf,
} from '@event-driven-io/emmett';
import { assertType, type C2, type D1, type Equals, type Stored, type V1, type V2, type V2m } from './domain';

assertType<Equals<MessageSchemaVersionOf<V2>, 2>>();
assertType<Equals<MessageSchemaVersionOf<V1>, 1>>();
assertType<Equals<MessageSchemaVersionOf<Stored>, 1 | 2>>();
assertType<Equals<MessageSchemaVersionOf<Event>, number>>();
assertType<Equals<MessageSchemaVersionOf<C2>, 2>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assertType<Equals<MessageSchemaVersionOf<AnyEvent>, any>>();
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
assertType<Equals<MessageSchemaVersionOf<CreateEventType<'X', D1>>, {}>>();

// the helper types are not importable from the package
// @ts-expect-error not exported
import type { SchemaVersionArgument } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import type { MetadataArgument } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import type { SchemaVersionProperty } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import { liftSchemaVersion } from '@event-driven-io/emmett';

// inferred exports that a consumer library with declaration emit would have to name
const productItem = { productId: 'p', quantity: 1 };
export const makeV2 = () => event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
export const makeV2m = (tenant: string) =>
  event<V2m>('ProductItemAdded', { productItem }, { tenant, schemaVersion: 2 });
export const makeC2 = () => command<C2>('AddProductItem', { productItem }, { schemaVersion: 2 });
export const factory = event;
export const forward = (...args: Parameters<typeof event<V2>>) => event<V2>(...args);
export type FactoryArgs = Parameters<typeof event<V2m>>;
export type Inline = Event<'Inline', D1, undefined, 3>;
export const inline = (): Inline => ({ type: 'Inline', data: { productId: 'p' }, schemaVersion: 3 });
export const inferred = () => ({ ...makeV2(), extra: true });

