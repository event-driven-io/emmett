import type { Command } from './command';
import type { Event } from './event';

/// Inspired by https://blog.bittacklr.be/the-workflow-pattern.html

export type Workflow<
  Input extends Event | Command,
  State,
  Output extends Event | Command,
> = {
  decide: (command: Input, state: State) => WorkflowOutput<Output>[];
  evolve: (currentState: State, event: WorkflowEvent<Output>) => State;
  getInitialState: () => State;
};

export type WorkflowEvent<Output extends Command | Event> = Extract<
  Output,
  { __brand?: 'Event' }
>;

export type WorkflowCommand<Output extends Command | Event> = Extract<
  Output,
  { __brand?: 'Command' }
>;

export type WorkflowOutput<TOutput extends Command | Event> =
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

export const reply = <TOutput extends Command | Event>(
  message: TOutput,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Reply',
    message,
  };
};

export const send = <TOutput extends Command | Event>(
  message: WorkflowCommand<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Send',
    message,
  };
};

export const publish = <TOutput extends Command | Event>(
  message: WorkflowEvent<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Publish',
    message,
  };
};

export const schedule = <TOutput extends Command | Event>(
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
  TOutput extends Command | Event,
>(): WorkflowOutput<TOutput> => {
  return {
    kind: 'Complete',
  };
};

export const ignore = <TOutput extends Command | Event>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Ignore',
    reason,
  };
};

export const error = <TOutput extends Command | Event>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    kind: 'Error',
    reason,
  };
};

export const accept = <
  TOutput extends Command | Event,
>(): WorkflowOutput<TOutput> => {
  return { kind: 'Accept' };
};
