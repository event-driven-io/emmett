import type { EventStore } from '../eventStore';
import { type Command, type Event } from '../typing';
import type { Decider } from '../typing/decider';
import {
  CommandHandler,
  type CommandHandlerOptions,
  type HandleOptions,
} from './handleCommand';

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

    return CommandHandler<State, StreamEvent>(rest)(
      eventStore,
      id,
      deciders,
      handleOptions,
    );
  };
// #endregion command-handler
