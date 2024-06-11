import assert, { AssertionError } from 'assert';
import { isErrorConstructor, type ErrorConstructor } from '../errors';

type ErrorCheck<ErrorType> = (error: ErrorType) => boolean;

export type ThenThrows<ErrorType extends Error> =
  | (() => void)
  | ((errorConstructor: ErrorConstructor<ErrorType>) => void)
  | ((errorCheck: ErrorCheck<ErrorType>) => void)
  | ((
      errorConstructor: ErrorConstructor<ErrorType>,
      errorCheck?: ErrorCheck<ErrorType>,
    ) => void);

export type DeciderSpecfication<Command, Event> = (
  givenEvents: Event | Event[],
) => {
  when: (command: Command) => {
    then: (expectedEvents: Event | Event[]) => void;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => void;
  };
};

export const DeciderSpecification = {
  for: <Command, Event, State>(decider: {
    decide: (command: Command, state: State) => Event | Event[];
    evolve: (state: State, event: Event) => State;
    initialState: () => State;
  }): DeciderSpecfication<Command, Event> => {
    {
      return (givenEvents: Event | Event[]) => {
        return {
          when: (command: Command) => {
            const handle = () => {
              const existingEvents = Array.isArray(givenEvents)
                ? givenEvents
                : [givenEvents];

              const currentState = existingEvents.reduce<State>(
                decider.evolve,
                decider.initialState(),
              );

              return decider.decide(command, currentState);
            };

            return {
              then: (expectedEvents: Event | Event[]): void => {
                const resultEvents = handle();

                const resultEventsArray = Array.isArray(resultEvents)
                  ? resultEvents
                  : [resultEvents];

                const expectedEventsArray = Array.isArray(expectedEvents)
                  ? expectedEvents
                  : [expectedEvents];

                assert.deepEqual(resultEventsArray, expectedEventsArray);
              },
              thenThrows: <ErrorType extends Error>(
                ...args: Parameters<ThenThrows<ErrorType>>
              ): void => {
                try {
                  handle();
                  assert.fail('Handler did not fail as expected');
                } catch (error) {
                  if (error instanceof AssertionError) throw error;

                  if (args.length === 0) return;

                  if (!isErrorConstructor(args[0])) {
                    assert.ok(
                      args[0](error as ErrorType),
                      `Error didn't match the error condition: ${error?.toString()}`,
                    );
                    return;
                  }

                  assert.ok(
                    error instanceof args[0],
                    `Caught error is not an instance of the expected type: ${error?.toString()}`,
                  );

                  if (args[1]) {
                    assert.ok(
                      args[1](error),
                      `Error didn't match the error condition: ${error?.toString()}`,
                    );
                  }
                }
              },
            };
          },
        };
      };
    }
  },
};
