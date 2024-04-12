import type { DefaultRecord, Flavour } from './';
export type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord = DefaultCommandMetadata,
> = Flavour<
  Readonly<{
    type: CommandType;
    data: Readonly<CommandData>;
    metadata?: CommandMetaData | undefined;
  }>,
  'Command'
>;

export type CommandTypeOf<T extends Command> = T['type'];
export type CommandDataOf<T extends Command> = T['data'];
export type CommandMetaDataOf<T extends Command> = T['metadata'];

export type CreateCommandType<
  CommandType extends string,
  CommandData extends DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined,
> = Readonly<{
  type: CommandType;
  data: CommandData;
  metadata?: CommandMetaData;
}>;

export const command = <CommandType extends Command>(
  type: CommandTypeOf<CommandType>,
  data: CommandDataOf<CommandType>,
  metadata?: CommandMetaDataOf<CommandType>,
): CreateCommandType<
  CommandTypeOf<CommandType>,
  CommandDataOf<CommandType>,
  CommandMetaDataOf<CommandType>
> => {
  return {
    type,
    data,
    metadata,
  };
};

export type DefaultCommandMetadata = { now: Date };
