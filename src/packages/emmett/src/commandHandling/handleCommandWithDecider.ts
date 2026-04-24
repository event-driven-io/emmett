import type { EventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';
import {
  CommandHandler,
  type CommandHandlerOptions,
  type HandleOptions,
} from './handleCommand';

const commandTypesOf = (commands: Command | Command[]): string | string[] =>
  Array.isArray(commands) ? commands.map((c) => c.type) : commands.type;

// #region command-handler

export type DeciderCommandHandlerOptions<
  State,
  CommandType extends Command,
  StreamEvent extends Event,
> = CommandHandlerOptions<State, StreamEvent> &
  Decider<State, CommandType, StreamEvent>;

export const DeciderCommandHandler =
  <State, CommandType extends Command, StreamEvent extends Event>(
    options: DeciderCommandHandlerOptions<State, CommandType, StreamEvent>,
  ) =>
  async <Store extends EventStore>(
    eventStore: Store,
    id: string,
    commands: CommandType | CommandType[],
    handleOptions?: HandleOptions<Store>,
  ) => {
    const { decide, ...rest } = options;

    const deciders = (Array.isArray(commands) ? commands : [commands]).map(
      (command) => (state: State) => decide(command, state),
    );

    // TODO: forwarding an array of command types to a single span attribute
    // mirrors the array-of-handlers case in CommandHandler — revisit once we
    // decide on per-command child scopes vs. a single parent with an array
    // attribute.
    return CommandHandler<State, StreamEvent>(rest)(eventStore, id, deciders, {
      ...handleOptions,
      observability: {
        ...handleOptions?.observability,
        commandType: commandTypesOf(commands),
      },
    });
  };
// #endregion command-handler
