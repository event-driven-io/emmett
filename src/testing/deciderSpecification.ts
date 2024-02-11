import assert from 'assert';

export type DeciderSpecfication<Command, Event> = (
  givenEvents: Event | Event[],
) => {
  when: (command: Command) => {
    then: (expectedEvents: Event | Event[]) => void;
    thenThrows: <Error>(assert: (error: Error) => boolean) => void;
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
              thenThrows: <Error>(check?: (error: Error) => boolean): void => {
                try {
                  handle();
                  assert.fail('Handler did not fail as expected');
                } catch (error) {
                  if (check) assert.ok(check(error as Error));
                }
              },
            };
          },
        };
      };
    }
  },
};
