import type { AnyCommand, AnyEvent } from './';

export type Decider<
  State,
  CommandType extends AnyCommand,
  StreamEvent extends AnyEvent,
> = {
  decide: (command: CommandType, state: State) => StreamEvent | StreamEvent[];
  evolve: (currentState: State, event: StreamEvent) => State;
  initialState: () => State;
};
