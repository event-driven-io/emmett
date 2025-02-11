import { isErrorConstructor, type ErrorConstructor } from '../errors';
import { AssertionError, assertThatArray, assertTrue } from './assertions';

type ErrorCheck<ErrorType> = (error: ErrorType) => boolean;

export type ThenThrows<ErrorType extends Error> =
  | (() => void)
  | ((errorConstructor: ErrorConstructor<ErrorType>) => void)
  | ((errorCheck: ErrorCheck<ErrorType>) => void)
  | ((
      errorConstructor: ErrorConstructor<ErrorType>,
      errorCheck?: ErrorCheck<ErrorType>,
    ) => void);

export type DeciderSpecification<Command, Event> = (
  givenEvents: Event | Event[],
) => {
  when: (command: Command) => {
    then: (expectedEvents: Event | Event[]) => void;
    thenNothingHappened: () => void;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => void;
  };
};
export type AsyncDeciderSpecification<Command, Event> = (
  givenEvents: Event | Event[],
) => {
  when: (command: Command) => {
    then: (expectedEvents: Event | Event[]) => Promise<void>;
    thenNothingHappened: () => Promise<void>;
    thenThrows: <ErrorType extends Error = Error>(
      ...args: Parameters<ThenThrows<ErrorType>>
    ) => Promise<void>;
  };
};

export const DeciderSpecification = {
  for: deciderSpecificationFor,
};

function deciderSpecificationFor<Command, Event, State>(decider: {
  decide: (command: Command, state: State) => Event | Event[];
  evolve: (state: State, event: Event) => State;
  initialState: () => State;
}): DeciderSpecification<Command, Event>;
function deciderSpecificationFor<Command, Event, State>(decider: {
  decide: (command: Command, state: State) => Promise<Event | Event[]>;
  evolve: (state: State, event: Event) => State;
  initialState: () => State;
}): AsyncDeciderSpecification<Command, Event>;
function deciderSpecificationFor<Command, Event, State>(decider: {
  decide: (
    command: Command,
    state: State,
  ) => Event | Event[] | Promise<Event | Event[]>;
  evolve: (state: State, event: Event) => State;
  initialState: () => State;
}):
  | DeciderSpecification<Command, Event>
  | AsyncDeciderSpecification<Command, Event> {
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
            then: (expectedEvents: Event | Event[]): void | Promise<void> => {
              const resultEvents = handle();

              if (resultEvents instanceof Promise) {
                return resultEvents.then((events) => {
                  thenHandler(events, expectedEvents);
                });
              }

              thenHandler(resultEvents, expectedEvents);
            },
            thenNothingHappened: (): void | Promise<void> => {
              const resultEvents = handle();

              if (resultEvents instanceof Promise) {
                return resultEvents.then((events) => {
                  thenNothingHappensHandler(events);
                });
              }

              thenNothingHappensHandler(resultEvents);
            },
            thenThrows: <ErrorType extends Error>(
              ...args: Parameters<ThenThrows<ErrorType>>
            ): void | Promise<void> => {
              try {
                const result = handle();
                if (result instanceof Promise) {
                  return result
                    .then(() => {
                      throw new AssertionError(
                        'Handler did not fail as expected',
                      );
                    })
                    .catch((error) => {
                      thenThrowsErrorHandler(error, args);
                    });
                }
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
}

function thenHandler<Event>(
  events: Event | Event[],
  expectedEvents: Event | Event[],
): void {
  const resultEventsArray = Array.isArray(events) ? events : [events];

  const expectedEventsArray = Array.isArray(expectedEvents)
    ? expectedEvents
    : [expectedEvents];

  assertThatArray(resultEventsArray).containsOnlyElementsMatching(
    expectedEventsArray,
  );
}

function thenNothingHappensHandler<Event>(events: Event | Event[]): void {
  const resultEventsArray = Array.isArray(events) ? events : [events];
  assertThatArray(resultEventsArray).isEmpty();
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
