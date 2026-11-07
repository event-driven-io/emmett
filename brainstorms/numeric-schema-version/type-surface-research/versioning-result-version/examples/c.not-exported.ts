// @ts-expect-error not exported
import type { VersioningResult } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import type { DeclaresSchemaVersion } from '@event-driven-io/emmett';
// @ts-expect-error not exported
import type { WithRequiredSchemaVersion } from '@event-driven-io/emmett';
import { CommandHandler } from '@event-driven-io/emmett';
import type { Stored, V2 } from './domain';
const d2 = { productItem: { productId: 'p', quantity: 1 } };
export const handler = CommandHandler<{ n: number }, V2, Stored>({
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
  schema: { versioning: { upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }) } },
});
export const options = { versioning: { downcast: (e: V2) => e } };
