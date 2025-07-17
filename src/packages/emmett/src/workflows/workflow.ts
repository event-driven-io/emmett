import type { AnyCommand } from '../typing/command';
import type { AnyEvent } from '../typing/event';

/// Inspired by https://blog.bittacklr.be/the-workflow-pattern.html

export type Workflow<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
> = {
  decide: (command: Input, state: State) => WorkflowOutput<Output>[];
  evolve: (currentState: State, event: WorkflowEvent<Output>) => State;
  initialState: () => State;
};

export type WorkflowEvent<Output extends AnyEvent | AnyCommand> = Extract<
  Output,
  { kind?: 'Event' }
>;

export type WorkflowCommand<Output extends AnyEvent | AnyCommand> = Extract<
  Output,
  { kind?: 'Command' }
>;

export type WorkflowOutput<TOutput extends AnyEvent | AnyCommand> =
  | { action: 'Reply'; message: TOutput }
  | { action: 'Send'; message: WorkflowCommand<TOutput> }
  | { action: 'Publish'; message: WorkflowEvent<TOutput> }
  | {
      action: 'Schedule';
      message: TOutput;
      when: { afterInMs: number } | { at: Date };
    }
  | { action: 'Complete' }
  | { action: 'Accept' }
  | { action: 'Ignore'; reason: string }
  | { action: 'Error'; reason: string };

export const reply = <TOutput extends AnyEvent | AnyCommand>(
  message: TOutput,
): WorkflowOutput<TOutput> => {
  return {
    action: 'Reply',
    message,
  };
};

export const send = <TOutput extends AnyEvent | AnyCommand>(
  message: WorkflowCommand<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    action: 'Send',
    message,
  };
};

export const publish = <TOutput extends AnyEvent | AnyCommand>(
  message: WorkflowEvent<TOutput>,
): WorkflowOutput<TOutput> => {
  return {
    action: 'Publish',
    message,
  };
};

export const schedule = <TOutput extends AnyEvent | AnyCommand>(
  message: TOutput,
  when: { afterInMs: number } | { at: Date },
): WorkflowOutput<TOutput> => {
  return {
    action: 'Schedule',
    message,
    when,
  };
};

export const complete = <
  TOutput extends AnyEvent | AnyCommand,
>(): WorkflowOutput<TOutput> => {
  return {
    action: 'Complete',
  };
};

export const ignore = <TOutput extends AnyEvent | AnyCommand>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    action: 'Ignore',
    reason,
  };
};

export const error = <TOutput extends AnyEvent | AnyCommand>(
  reason: string,
): WorkflowOutput<TOutput> => {
  return {
    action: 'Error',
    reason,
  };
};

export const accept = <
  TOutput extends AnyEvent | AnyCommand,
>(): WorkflowOutput<TOutput> => {
  return { action: 'Accept' };
};
