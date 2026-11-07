import { command, event, type MessageSchemaVersionOf } from '@event-driven-io/emmett';
import { assertType, type C2, type Equals, type V2, type V2m } from './domain';

assertType<Equals<MessageSchemaVersionOf<V2>, 2>>();

// @ts-expect-error not exported
import type { WithSchemaVersionArgument } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import type { SchemaVersionProperty } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import { splitMetadataAndSchemaVersion } from '@event-driven-io/emmett';

const productItem = { productId: 'p', quantity: 1 };
export const makeV2 = () => event<V2>('ProductItemAdded', { productItem }, 2);
export const makeV2m = (tenant: string) => event<V2m>('ProductItemAdded', { productItem }, { tenant }, 2);
export const makeC2 = (now?: Date) => command<C2>('AddProductItem', { productItem }, now ? { now } : undefined, 2);
export const factory = command;
export type CommandArgs = Parameters<typeof command<C2>>;
