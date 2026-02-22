import { isErrorConstructor } from '../errors';
import type { AnyCommand } from '../typing/command';
import type { AnyEvent } from '../typing/event';
import type { Workflow, WorkflowEvent } from '../workflows/workflow';
import { AssertionError, assertThatArray, assertTrue } from './assertions';
import type { ThenThrows } from './deciderSpecification';

export type WorkflowSpecification<
  Input extends AnyEvent | AnyCommand,
  Output extends AnyEvent | AnyCommand,
> = (
  givenEvents: WorkflowEvent<Input | Output> | WorkflowEvent<Input | Output>[],
) => {
  when: (input: Input) => {
    then: (expectedOutput: Output | Output[]) => void;
    thenNothingHappened: () => void;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => void;
  };
};

export const WorkflowSpecification = {
  for: workflowSpecificationFor,
};

function workflowSpecificationFor<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
>(
  workflow: Workflow<Input, State, Output>,
): WorkflowSpecification<Input, Output> {
  return (
    givenEvents:
      | WorkflowEvent<Input | Output>
      | WorkflowEvent<Input | Output>[],
  ) => {
    return {
      when: (input: Input) => {
        const handle = () => {
          const existingEvents = Array.isArray(givenEvents)
            ? givenEvents
            : [givenEvents];

          const currentState = existingEvents.reduce<State>(
            workflow.evolve,
            workflow.initialState(),
          );

          return workflow.decide(input, currentState);
        };

        return {
          then: (expectedOutput: Output | Output[]): void => {
            const result = handle();
            thenHandler(result, expectedOutput);
          },
          thenNothingHappened: (): void => {
            const result = handle();
            thenNothingHappensHandler(result);
          },
          thenThrows: <ErrorType extends Error>(
            ...args: Parameters<ThenThrows<ErrorType>>
          ): void => {
            try {
              handle();
              throw new AssertionError('Handler did not fail as expected');
            } catch (error) {
              thenThrowsErrorHandler(error, args);
            }
          },
        };
      },
    };
  };
}

function thenHandler<Output>(
  result: Output | Output[],
  expectedOutput: Output | Output[],
): void {
  const resultArray = Array.isArray(result) ? result : [result];
  const expectedArray = Array.isArray(expectedOutput)
    ? expectedOutput
    : [expectedOutput];

  assertThatArray(resultArray).containsOnlyElementsMatching(expectedArray);
}

function thenNothingHappensHandler<Output>(result: Output | Output[]): void {
  const resultArray = Array.isArray(result) ? result : [result];
  assertThatArray(resultArray).isEmpty();
}

function thenThrowsErrorHandler<ErrorType extends Error>(
  error: unknown,
  args: Parameters<ThenThrows<ErrorType>>,
): void {
  if (error instanceof AssertionError) throw error;

  if (args.length === 0) return;

  if (!isErrorConstructor(args[0])) {
    assertTrue(
      args[0](error as ErrorType),
      `Error didn't match the error condition: ${error?.toString()}`,
    );
    return;
  }

  assertTrue(
    error instanceof args[0],
    `Caught error is not an instance of the expected type: ${error?.toString()}`,
  );

  if (args[1]) {
    assertTrue(
      args[1](error as ErrorType),
      `Error didn't match the error condition: ${error?.toString()}`,
    );
  }
}
