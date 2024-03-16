import type { Event, Command } from '@event-driven-io/emmett';
import { IllegalStateError, CommandHandler } from '@event-driven-io/emmett';
import { match } from 'ts-pattern';

export type CounterIncremented = Event<'CounterIncremented', { by: number }>;
export type CounterDecremented = Event<'CounterDecremented', { by: number }>;
export type CounterSubmitted = Event<'CounterSubmitted'>;

export type CounterEvent =
  | CounterIncremented
  | CounterDecremented
  | CounterSubmitted;

export type IncrementCounter = Command<
  'IncrementCounter',
  { counterId: string; by?: number }
>;
export type DecrementCounter = Command<
  'DecrementCounter',
  { counterId: string; by?: number }
>;
export type SubmitCounter = Command<'SubmitCounter'>;

export type CounterCommand =
  | IncrementCounter
  | DecrementCounter
  | SubmitCounter;

export type OpenedCounter = { status: 'opened'; value: number };
export type SubmittedCounter = { status: 'submitted'; value: number };
export type Counter = OpenedCounter | SubmittedCounter;

export const incrementCounter = (command: IncrementCounter, state: Counter) => {
  if (state.status === 'submitted') {
    throw new IllegalStateError('Cannot increment a submitted counter');
  }

  const { data } = command;

  return {
    type: 'CounterIncremented',
    data: {
      by: data.by ?? 1,
    },
  } satisfies CounterIncremented;
};

export const decrementCounter = (command: DecrementCounter, state: Counter) => {
  if (state.status === 'submitted') {
    throw new IllegalStateError('Cannot decrement a submitted counter');
  }

  const { data } = command;

  return {
    type: 'CounterDecremented',
    data: {
      by: data.by ?? 1,
    },
  } satisfies CounterDecremented;
};

export const submitCounter = (command: SubmitCounter, state: Counter) => {
  if (state.status === 'submitted') {
    throw new IllegalStateError('Cannot submit a submitted counter');
  }

  return {
    type: 'CounterSubmitted',
    data: {},
  } satisfies CounterSubmitted;
};

export const decide = (rawCommand: CounterCommand, state: Counter) => {
  return match(rawCommand)
    .with({ type: 'IncrementCounter' }, (command) =>
      incrementCounter(command, state),
    )
    .with({ type: 'DecrementCounter' }, (command) =>
      decrementCounter(command, state),
    )
    .with({ type: 'SubmitCounter' }, (command) => submitCounter(command, state))
    .exhaustive();
};

export const getInitialState = () => {
  return {
    status: 'opened',
    value: 0,
  } as OpenedCounter;
};

export const evolve = (state: Counter, event: CounterEvent) => {
  return match(event)
    .with({ type: 'CounterIncremented' }, ({ data }) => {
      return {
        ...state,
        value: state.value + data.by,
      } as OpenedCounter;
    })
    .with({ type: 'CounterDecremented' }, ({ data }) => {
      return {
        ...state,
        value: state.value - data.by,
      } as OpenedCounter;
    })
    .with({ type: 'CounterSubmitted' }, () => {
      return {
        ...state,
        status: 'submitted',
      } as SubmittedCounter;
    })
    .exhaustive();
};

export const handle = CommandHandler(evolve, getInitialState);
