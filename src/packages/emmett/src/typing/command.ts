import type { AnyRecord, DefaultRecord } from './';

export type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
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
> & { readonly kind?: 'Command' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, AnyRecord, AnyRecord | undefined>;

export type CommandTypeOf<T extends AnyCommand> = T['type'];
export type CommandDataOf<T extends AnyCommand> = T['data'];
export type CommandMetaDataOf<T extends AnyCommand> = T extends {
  metadata: infer M;
}
  ? M
  : undefined;

export type CreateCommandType<
  CommandType extends string,
  CommandData extends DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
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
> & { readonly kind?: 'Command' };

export const command = <CommandType extends AnyCommand>(
  ...args: CommandMetaDataOf<CommandType> extends undefined
    ? [
        type: CommandTypeOf<CommandType>,
        data: CommandDataOf<CommandType>,
        metadata?: DefaultCommandMetadata | undefined,
      ]
    : [
        type: CommandTypeOf<CommandType>,
        data: CommandDataOf<CommandType>,
        metadata: CommandMetaDataOf<CommandType>,
      ]
): CommandType => {
  const [type, data, metadata] = args;

  return metadata !== undefined
    ? ({ type, data, metadata, kind: 'Command' } as CommandType)
    : ({ type, data, kind: 'Command' } as CommandType);
};

export type DefaultCommandMetadata = { now: Date };
