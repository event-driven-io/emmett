import type { AnyCommand, Command } from './command';
import type { AnyEvent, Event } from './event';

/// Inspired by https://blog.bittacklr.be/the-workflow-pattern.html

export type Workflow<
  Input extends AnyEvent | Command,
  State,
  Output extends AnyEvent | Command,
> = {
  decide: (command: Input, state: State) => WorkflowOutput<Output>[];
  evolve: (currentState: State, event: WorkflowEvent<Output>) => State;
  initialState: () => State;
};

export type WorkflowEvent<Output extends AnyCommand | Event> = Extract<
  Output,
  { __brand?: 'Event' }
>;

export type WorkflowCommand<Output extends AnyCommand | Event> = Extract<
  Output,
  { __brand?: 'Command' }
>;

export type WorkflowOutput<TOutput extends AnyCommand | Event> =
  | { kind: 'Reply'; message: TOutput }
  | { kind: 'Send'; message: WorkflowCommand<TOutput> }
  | { kind: 'Publish'; message: WorkflowEvent<TOutput> }
  | {
      kind: 'Schedule';
      message: TOutput;
      when: { afterInMs: number } | { at: Date };
    }
  | { kind: 'Complete' }
  | { kind: 'Accept' }
  | { kind: 'Ignore'; reason: string }
  | { kind: 'Error'; reason: string };

export const reply = <TOutput extends AnyCommand | Event>(
  message: TOutput,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Reply',
    message,
  };
};

export const send = <TOutput extends AnyCommand | Event>(
  message: WorkflowCommand<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Send',
    message,
  };
};

export const publish = <TOutput extends AnyCommand | Event>(
  message: WorkflowEvent<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Publish',
    message,
  };
};

export const schedule = <TOutput extends AnyCommand | Event>(
  message: TOutput,
  when: { afterInMs: number } | { at: Date },
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Schedule',
    message,
    when,
  };
};

export const complete = <
  TOutput extends AnyCommand | Event,
>(): WorkflowOutput<TOutput> => {
  return {
    kind: 'Complete',
  };
};

export const ignore = <TOutput extends AnyCommand | Event>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Ignore',
    reason,
  };
};

export const error = <TOutput extends AnyCommand | Event>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Error',
    reason,
  };
};

export const accept = <
  TOutput extends AnyCommand | Event,
>(): WorkflowOutput<TOutput> => {
  return { kind: 'Accept' };
};
