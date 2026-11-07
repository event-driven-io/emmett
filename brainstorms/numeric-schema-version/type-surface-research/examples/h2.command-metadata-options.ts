import type {
  Command,
  CommandDataOf,
  CommandMetaDataOf,
  CommandTypeOf,
  DefaultCommandMetadata,
  MessageSchemaVersionOf,
} from '@event-driven-io/emmett';
import type { C1, C2 } from './domain';

const productItem = { productId: 'p', quantity: 1 };

// Option B: versioned command without declared metadata takes optional default metadata before the version
type ArgsB<C extends Command> =
  CommandMetaDataOf<C> extends undefined
    ? undefined extends C['schemaVersion']
      ? [type: CommandTypeOf<C>, data: CommandDataOf<C>, metadata?: DefaultCommandMetadata | undefined]
      :
          | [type: CommandTypeOf<C>, data: CommandDataOf<C>, schemaVersion: MessageSchemaVersionOf<C>]
          | [type: CommandTypeOf<C>, data: CommandDataOf<C>, metadata: DefaultCommandMetadata | undefined, schemaVersion: MessageSchemaVersionOf<C>]
    : undefined extends C['schemaVersion']
      ? [type: CommandTypeOf<C>, data: CommandDataOf<C>, metadata: CommandMetaDataOf<C>]
      : [type: CommandTypeOf<C>, data: CommandDataOf<C>, metadata: CommandMetaDataOf<C>, schemaVersion: MessageSchemaVersionOf<C>];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const commandB: <C extends Command<string, any, any, any>>(...args: ArgsB<C>) => C;

commandB<C2>('AddProductItem', { productItem }, 2);
commandB<C2>('AddProductItem', { productItem }, { now: new Date() }, 2);
commandB<C2>('AddProductItem', { productItem }, undefined, 2);
// @ts-expect-error version still required
commandB<C2>('AddProductItem', { productItem }, { now: new Date() });
commandB<C1>('AddProductItem', { productId: 'p' }, { now: new Date() });
commandB<C1>('AddProductItem', { productId: 'p' });

// Option C: version first, optional default metadata after it (version not last)
type ArgsC<C extends Command> =
  undefined extends C['schemaVersion']
    ? [type: CommandTypeOf<C>, data: CommandDataOf<C>, metadata?: DefaultCommandMetadata | undefined]
    : [type: CommandTypeOf<C>, data: CommandDataOf<C>, schemaVersion: MessageSchemaVersionOf<C>, metadata?: DefaultCommandMetadata | undefined];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const commandC: <C extends Command<string, any, undefined, any>>(...args: ArgsC<C>) => C;
commandC<C2>('AddProductItem', { productItem }, 2);
commandC<C2>('AddProductItem', { productItem }, 2, { now: new Date() });
