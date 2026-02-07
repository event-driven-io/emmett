import type { Command as CliCommand } from 'commander';
import path from 'path';
import {
  isPluginConfig,
  type EmmettCliCommand,
  type EmmettCliPlugin,
  type EmmettPlugin,
  type EmmettPluginConfig,
  type EmmettPluginsConfig,
  type EmmettPluginType,
} from '../config';
import { EmmettError } from '../errors';
import { sampleConfig } from './config';

const PluginsConfigImportError = {
  missingDefaultExport: `Error: Config should contain default export, e.g.\n\n${sampleConfig()}`,
  missingPluginsPropertyExport: `Error: Config should contain default export with plugins array, e.g.\n\n${sampleConfig()}`,
  wrongPluginStructure: `Error: Plugin config should be either string with plugin name or object with plugin name, e.g. { name: 'emmett-expressjs' }`,
};
export const importPluginsConfig = async (options?: {
  configPath?: string | undefined;
}): Promise<EmmettPluginsConfig | EmmettError> => {
  const configPath = path.join(
    process.cwd(),
    options?.configPath ?? './dist/emmett.config.js',
  );

  console.log('IMPORTING' + configPath);

  try {
    const imported = (await import(configPath)) as {
      default: Partial<EmmettPluginsConfig>;
    };

    if (!imported.default) {
      return new EmmettError(PluginsConfigImportError.missingDefaultExport);
    }

    if (!imported.default.plugins || !Array.isArray(imported.default.plugins)) {
      return new EmmettError(
        PluginsConfigImportError.missingPluginsPropertyExport,
      );
    }

    if (!imported.default.plugins.every(isPluginConfig)) {
      return new EmmettError(PluginsConfigImportError.wrongPluginStructure);
    }

    return { plugins: imported.default.plugins };
  } catch (error) {
    if (!options?.configPath) {
      console.warn('Didn`t find config file: ' + configPath, error);
      return { plugins: [] };
    }
    return new EmmettError(
      `Error: Couldn't load file:` + (error as Error).toString(),
    );
  }
};

export const loadPlugins = async (options?: {
  pluginType?: EmmettPluginType;
  configPath?: string;
}): Promise<EmmettPlugin[]> => {
  try {
    const pluginsConfig = await importPluginsConfig({
      configPath: options?.configPath,
    });

    if (pluginsConfig instanceof EmmettError) throw pluginsConfig;

    if (pluginsConfig.plugins.length === 0) {
      console.log(`No extensions specified in config ${options?.configPath}.`);
      return [];
    }

    const pluginsToLoad = filterPluginsByType(
      pluginsConfig.plugins,
      options?.pluginType,
    );

    const pluginsPromises = pluginsToLoad.map(async (pluginConfig) => {
      const importPath = getImportPath(pluginConfig, options?.pluginType);
      try {
        const plugin = (await import(importPath)) as { default: EmmettPlugin };

        console.info(`Loaded plugin: ${importPath}`);

        if (!plugin.default) {
          throw new Error(`Plugin: ${importPath} is missing default export`);
        }

        return plugin.default;
      } catch (error) {
        console.error(`Failed to load extension "${importPath}":`, error);
        return undefined;
      }
    });

    return (await Promise.all(pluginsPromises)).filter(
      (plugin) => plugin !== undefined,
    );
  } catch (error) {
    console.error(`Failed to load config ${options?.configPath}:`, error);
    return [];
  }
};

export const registerCliPlugins = async (
  program: CliCommand,
  plugins: EmmettCliPlugin[],
): Promise<void> => {
  const result: EmmettCliPlugin[] = [];

  for (const plugin of plugins) {
    const pluginName = plugin.name;

    if (!('registerCommands' in plugin)) {
      console.warn(`No registerCommands function found in ${pluginName}`);
    }
    await plugin.registerCommands(program as EmmettCliCommand);
    console.log(`Loaded extension: ${plugin.name}`);
    result.push(plugin);
  }
};

const filterPluginsByType = (
  plugins: EmmettPluginConfig[],
  pluginType?: EmmettPluginType,
): EmmettPluginConfig[] =>
  plugins.filter(
    (p) =>
      typeof p === 'string' ||
      (pluginType &&
        (p.register === undefined ||
          p.register.some((r) => r.pluginType === pluginType))),
  );

const getImportPath = (
  pluginConfig: EmmettPluginConfig,
  pluginType: EmmettPluginType | undefined,
) => {
  if (typeof pluginConfig === 'string') {
    return pluginType ? `${pluginConfig}/${pluginType}` : pluginConfig;
  }

  const pluginSubpath =
    pluginConfig.register.find((r) => pluginType && r.pluginType === pluginType)
      ?.path ?? pluginType;

  return pluginSubpath
    ? `${pluginConfig.name}/${pluginSubpath}`
    : pluginConfig.name;
};
