import type {
  DefaultStreamVersionType,
  EventStore,
  ExpectedStreamVersion,
} from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';
import {
  CommandHandler,
  type CommandHandlerOptions,
  type CommandHandlerRetryOptions,
} from './handleCommand';

// #region command-handler

export type DeciderCommandHandlerOptions<
  State,
  CommandType extends Command,
  StreamEvent extends Event,
> = CommandHandlerOptions<State, StreamEvent> &
  Decider<State, CommandType, StreamEvent>;

export const DeciderCommandHandler =
  <
    State,
    CommandType extends Command,
    StreamEvent extends Event,
    StreamVersion = DefaultStreamVersionType,
  >(
    { decide, evolve, initialState }: Decider<State, CommandType, StreamEvent>,
    mapToStreamId: (id: string) => string = (id) => id,
  ) =>
  async (
    eventStore: EventStore<StreamVersion>,
    id: string,
    command: CommandType,
    handleOptions?:
      | {
          expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
        }
      | {
          retry?: CommandHandlerRetryOptions;
        },
  ) =>
    CommandHandler<State, StreamEvent, StreamVersion>({
      evolve,
      initialState,
      mapToStreamId,
    })(eventStore, id, (state) => decide(command, state), handleOptions);
// #endregion command-handler
