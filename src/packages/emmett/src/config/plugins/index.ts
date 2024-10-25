export type EmmettPluginConfig =
  | {
      name: string;
      register: EmmettPluginRegistration[];
    }
  | string;

export type EmmettPluginType = 'cli';

export type EmmettCliPluginRegistration = { pluginType: 'cli'; path?: string };

export type EmmettPluginRegistration = EmmettCliPluginRegistration;

export type EmmettCliCommand = {
  addCommand<CliCommand>(command: CliCommand): CliCommand;
};

export type EmmettCliPlugin = {
  pluginType: 'cli';
  name: string;
  registerCommands: (program: EmmettCliCommand) => Promise<void> | void;
};

export type EmmettPlugin = EmmettCliPlugin;

export const isPluginConfig = (
  plugin: Partial<EmmettPluginConfig> | string | undefined,
): plugin is EmmettPluginConfig =>
  plugin !== undefined &&
  (typeof plugin === 'string' ||
    ('name' in plugin &&
      plugin.name !== undefined &&
      typeof plugin.name === 'string'));
