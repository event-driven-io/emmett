import type { DefaultRecord } from './';
import {
  splitMetadataAndSchemaVersion,
  type SchemaVersionProperty,
  type WithSchemaVersionArgument,
} from './messageSchemaVersion';

export type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number = string extends CommandType ? number : 1,
> = Readonly<
  CommandMetaData extends undefined
    ? {
        type: CommandType;
        data: Readonly<CommandData>;
        metadata?: DefaultCommandMetadata | undefined;
      }
    : {
        type: CommandType;
        data: CommandData;
        metadata: CommandMetaData;
      }
> & { readonly kind?: 'Command' } & SchemaVersionProperty<SchemaVersion>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any, any, any>;

export type CommandTypeOf<T extends Command> = T['type'];
export type CommandDataOf<T extends Command> = T['data'];
export type CommandMetaDataOf<T extends Command> = T extends {
  metadata: infer M;
}
  ? M
  : undefined;

export type CreateCommandType<
  CommandType extends string,
  CommandData extends DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number = string extends CommandType ? number : 1,
> = Readonly<
  CommandMetaData extends undefined
    ? {
        type: CommandType;
        data: CommandData;
        metadata?: DefaultCommandMetadata | undefined;
      }
    : {
        type: CommandType;
        data: CommandData;
        metadata: CommandMetaData;
      }
> & { readonly kind?: 'Command' } & SchemaVersionProperty<SchemaVersion>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const command = <CommandType extends Command<string, any, any, any>>(
  ...args: CommandMetaDataOf<CommandType> extends undefined
    ? | WithSchemaVersionArgument<
          CommandType,
          [type: CommandTypeOf<CommandType>, data: CommandDataOf<CommandType>]
        >
      | WithSchemaVersionArgument<
          CommandType,
          [
            type: CommandTypeOf<CommandType>,
            data: CommandDataOf<CommandType>,
            metadata: DefaultCommandMetadata | undefined,
          ]
        >
    : WithSchemaVersionArgument<
        CommandType,
        [
          type: CommandTypeOf<CommandType>,
          data: CommandDataOf<CommandType>,
          metadata: CommandMetaDataOf<CommandType>,
        ]
      >
): CommandType => {
  const [type, data, ...optionalArguments] = args;

  return {
    type,
    data,
    kind: 'Command',
    ...splitMetadataAndSchemaVersion(optionalArguments),
  } as CommandType;
};

export type DefaultCommandMetadata = { now: Date };
