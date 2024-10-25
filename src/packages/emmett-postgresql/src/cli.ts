import type {
  EmmettCliCommand,
  EmmettCliPlugin,
} from '@event-driven-io/emmett';
import { migrateCommand } from './commandLine';

const cli: EmmettCliPlugin = {
  pluginType: 'cli',
  name: 'emmett-postgresql',
  registerCommands: (program: EmmettCliCommand) => {
    program.addCommand(migrateCommand);
  },
};

export default cli;
