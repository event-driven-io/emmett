import type { EventStore } from '../eventStore';
import type { Command, Event } from '../typing';
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
    command: CommandType,
    handleOptions?: HandleOptions<Store>,
  ) => {
    const { decide, ...rest } = options;

    return CommandHandler<State, StreamEvent>(rest)(
      eventStore,
      id,
      (state) => decide(command, state),
      handleOptions,
    );
  };
// #endregion command-handler
