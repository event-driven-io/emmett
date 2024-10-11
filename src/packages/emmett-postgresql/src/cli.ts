import type { EmmettCliPlugin } from '@event-driven-io/emmett';
import { migrateCommand } from './commandLine';

const cli: EmmettCliPlugin = {
  pluginType: 'cli',
  name: 'emmett-postgresql',
  registerCommands: (program) => {
    program.addCommand(migrateCommand);
  },
};

export default cli;
