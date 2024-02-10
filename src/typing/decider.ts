import type { Command, Event } from './';

export type Decider<
  State,
  CommandType extends Command,
  StreamEvent extends Event,
> = {
  decide: (command: CommandType, state: State) => StreamEvent | StreamEvent[];
  evolve: (currentState: State, event: StreamEvent) => State;
  getInitialState: () => State;
};
