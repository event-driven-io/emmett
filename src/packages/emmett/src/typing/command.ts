import type { DefaultRecord } from './';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const command = <CommandType extends Command<string, any, any>>(
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
