import { Command as CliCommand } from 'commander';
// eslint-disable-next-line no-restricted-imports
import fs from 'node:fs';
import process from 'process';

export const sampleConfig = (plugins: string[] = ['emmett-expressjs']) => {
  const pluginsNames =
    plugins.length > 0
      ? `[\n${plugins.map((p) => `"${p}"`).join(',\n')}  \n]`
      : '[]';

  return `
export default {
  plugins: ${pluginsNames},
};
`;
};

export const generateConfigFile = (
  configPath: string,
  collectionNames: string[],
): void => {
  try {
    fs.writeFileSync(configPath, sampleConfig(collectionNames), 'utf8');
    console.log(`Configuration file stored at: ${configPath}`);
  } catch (error) {
    console.error(`Error: Couldn't store config file: ${configPath}!`);
    console.error(error);
    process.exit(1);
  }
};

export const configCommand = new CliCommand('config').description(
  'Manage Pongo configuration',
);

type SampleConfigOptions =
  | {
      plugin: string[];
      print?: boolean;
    }
  | {
      plugin: string[];
      generate?: boolean;
      file?: string;
    };

configCommand
  .command('sample')
  .description('Generate or print sample configuration')
  .option(
    '-p, --plugins <name>',
    'Specify the plugin name',
    (value: string, previous: string[]) => {
      // Accumulate plugins names into an array (explicitly typing `previous` as `string[]`)
      return previous.concat([value]);
    },
    [] as string[],
  )
  .option(
    '-f, --file <path>',
    'Path to configuration file with collection list',
  )
  .option('-g, --generate', 'Generate sample config file')
  .option('-p, --print', 'Print sample config file')
  .action((options: SampleConfigOptions) => {
    const plugins =
      options.plugin.length > 0
        ? options.plugin
        : ['@event-driven-io/emmett-expressjs'];

    if (!('print' in options) && !('generate' in options)) {
      console.error(
        'Error: Please provide either:\n--print param to print sample config or\n--generate to generate sample config file',
      );
      process.exit(1);
    }

    if ('print' in options) {
      console.log(`${sampleConfig(plugins)}`);
    } else if ('generate' in options) {
      if (!options.file) {
        console.error(
          'Error: You need to provide a config file through a --file',
        );
        process.exit(1);
      }

      generateConfigFile(options.file, plugins);
    }
  });
