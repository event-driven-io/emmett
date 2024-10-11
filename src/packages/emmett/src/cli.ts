#!/usr/bin/env node
import { Command } from 'commander';
import { loadPlugins, registerCliPlugins } from './commandLine';

const program = new Command();

program
  .name('emmett')
  .description('CLI tool for Emmett')
  .option('--config <path>', 'Path to the configuration file');

// Load extensions and parse CLI arguments
const initCLI = async () => {
  const configIndex = process.argv.indexOf('--config');

  const configPath =
    configIndex !== -1 && process.argv.length > configIndex + 1
      ? process.argv[configIndex + 1]
      : undefined;

  try {
    const plugins = await loadPlugins({
      pluginType: 'cli',
      configPath: configPath,
    });
    await registerCliPlugins(program, plugins);

    // Parse the CLI arguments
    program.parse(process.argv);
  } catch (err) {
    console.error(`Failed to load config from ${configPath}:`, err);
  }
};

//Initialize CLI and handle errors
initCLI().catch((err) => {
  console.error(`CLI initialization failed:`);
  console.error(err);
});

export default program;
export * from './commandLine';
