import { describe, it } from 'node:test';
import { IllegalStateError, ValidationError } from '../errors';
import { AssertionError, assertThrows } from '../testing/assertions';
import type { Command, Event } from '../typing';
import { DeciderSpecification } from './deciderSpecification';

type DoSomething = Command<'Do', { something: string }>;
type SomethingHappened = Event<'Did', { something: string }>;
type Entity = { something: string };

const decide = (
  { data: { something } }: DoSomething,
  _entity: Entity,
): SomethingHappened | [] | [SomethingHappened] => {
  const event: SomethingHappened = { type: 'Did', data: { something } };

  if (something === 'Ignore!') return [];
  if (something === 'Array!') return [event];
  if (something !== 'Yes!') throw new IllegalStateError('Nope!');

  return event;
};

const initialState = (): Entity => ({ something: 'Meh' });

const evolve = (_entity: Entity, _event: SomethingHappened): Entity => ({
  something: 'Nothing',
});

const given = DeciderSpecification.for({
  decide: decide,
  evolve,
  initialState: initialState,
});

void describe('DeciderSpecification', () => {
  void describe('then', () => {
    void it('then fails if returns event, but assertion has an empty array', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Yes!',
              },
            })
            .then([]);
        },
        (error) =>
          error instanceof AssertionError &&
          error.message ===
            `Arrays lengths don't match:\nExpected: 1\nActual: 0`,
      );
    });
  });

  void describe('thenNothingHappened', () => {
    void it('thenNothingHappened succeeds if returns empty array', () => {
      given([])
        .when({
          type: 'Do',
          data: {
            something: 'Ignore!',
          },
        })
        .thenNothingHappened();
    });

    void it('thenNothingHappened fails if returns event', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Yes!',
              },
            })
            .thenNothingHappened();
        },
        (error) =>
          error instanceof AssertionError &&
          error.message ===
            `Array is not empty [{"type":"Did","data":{"something":"Yes!"}}]:\nExpected: 1\nActual: 0`,
      );
    });

    void it('thenNothingHappened fails if returns array of events', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Array!',
              },
            })
            .thenNothingHappened();
        },
        (error) =>
          error instanceof AssertionError &&
          error.message ===
            `Array is not empty [{"type":"Did","data":{"something":"Array!"}}]:\nExpected: 1\nActual: 0`,
      );
    });
  });

  void describe('thenThrows', () => {
    void it('check error was thrown', () => {
      given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows();
    });

    void it('checks error condition', () => {
      given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows((error) => error.message === 'Nope!');
    });

    void it('checks error type', () => {
      given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows(IllegalStateError);
    });

    void it('checks error type and condition', () => {
      given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows(IllegalStateError, (error) => error.message === 'Nope!');
    });

    void it('fails if no error was thrown', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Yes!',
              },
            })
            .thenThrows();
        },
        (error) =>
          error instanceof AssertionError &&
          error.message === 'Handler did not fail as expected',
      );
    });

    void it('fails if wrong error type', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Nope!',
              },
            })
            .thenThrows(ValidationError);
        },
        (error) =>
          error instanceof AssertionError &&
          error.message.startsWith(
            'Caught error is not an instance of the expected type:',
          ),
      );
    });

    void it('fails if wrong error type and correct condition', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Nope!',
              },
            })
            .thenThrows(ValidationError, (error) => error.message === 'Nope!');
        },
        (error) =>
          error instanceof AssertionError &&
          error.message.startsWith(
            'Caught error is not an instance of the expected type:',
          ),
      );
    });

    void it('fails if correct error type but wrong correct condition', () => {
      assertThrows(
        () => {
          given([])
            .when({
              type: 'Do',
              data: {
                something: 'Nope!',
              },
            })
            .thenThrows(
              IllegalStateError,
              (error) => error.message !== 'Nope!',
            );
        },
        (error) =>
          error instanceof AssertionError &&
          error.message ==
            `Error didn't match the error condition: Error: Nope!`,
      );
    });
  });
});
