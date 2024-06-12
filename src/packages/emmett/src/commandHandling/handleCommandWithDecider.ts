import type {
  DefaultStreamVersionType,
  EventStore,
  ExpectedStreamVersion,
} from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';
import { CommandHandler } from './handleCommand';

// #region command-handler
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
    options?: {
      expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
    },
  ) =>
    CommandHandler<State, StreamEvent, StreamVersion>(
      evolve,
      initialState,
      mapToStreamId,
    )(eventStore, id, (state) => decide(command, state), options);
// #endregion command-handler
