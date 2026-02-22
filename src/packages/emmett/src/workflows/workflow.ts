import type { EmmettError } from '../errors';
import type { AnyCommand } from '../typing/command';
import type { AnyEvent } from '../typing/event';

/// Inspired by https://blog.bittacklr.be/the-workflow-pattern.html

export type Workflow<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
> = {
  name: string;
  decide: (command: Input, state: State) => WorkflowOutput<Output>;
  evolve: (currentState: State, event: WorkflowEvent<Input | Output>) => State;
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

export type WorkflowMessageAction =
  | 'InitiatedBy'
  | 'Received'
  | 'Sent'
  | 'Published'
  | 'Scheduled';

export type WorkflowInputMessageMetadata = Readonly<{
  originalMessageId: string | undefined;
  input: true;
  action?: Extract<WorkflowMessageAction, 'InitiatedBy' | 'Received'>;
}>;

export type WorkflowOutputMessageMetadata = Readonly<{
  action?: Extract<WorkflowMessageAction, 'Sent' | 'Published' | 'Scheduled'>;
}>;

export type WorkflowOutput<Output extends AnyEvent | AnyCommand | EmmettError> =
  | Output
  | Output[];

export const Workflow = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
>(
  workflow: Workflow<Input, State, Output>,
): Workflow<Input, State, Output> => {
  return workflow;
};
