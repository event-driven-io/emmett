import type { Flavour } from './';

export type DefaultCommandMetadata = { now: Date };

export type Command<
  CommandType extends string = string,
  CommandData extends Record<string, unknown> = Record<string, unknown>,
  CommandMetaData extends Record<string, unknown> = DefaultCommandMetadata,
> = Flavour<
  Readonly<{
    type: CommandType;
    data: Readonly<CommandData>;
    metadata?: CommandMetaData | undefined;
  }>,
  'Command'
>;
