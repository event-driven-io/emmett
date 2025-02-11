import { describe, it } from 'node:test';
import { IllegalStateError, ValidationError } from '../errors';
import { AssertionError, assertTrue } from '../testing/assertions';
import { type Command, type Event } from '../typing';
import { DeciderSpecification } from './deciderSpecification';

type DoSomething = Command<'Do', { something: string }>;
type SomethingHappened = Event<'Did', { something: string }>;
type Entity = { something: string };

const decide = async (
  { data: { something } }: DoSomething,
  _entity: Entity,
): Promise<SomethingHappened | [] | [SomethingHappened]> => {
  const event: SomethingHappened = { type: 'Did', data: { something } };

  if (something === 'Ignore!') return [];
  if (something === 'Array!') return [event];
  if (something !== 'Yes!') throw new IllegalStateError('Nope!');

  return Promise.resolve(event);
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

void describe('AsyncDeciderSpecification', () => {
  void describe('then', () => {
    void it('then fails if returns event, but assertion has an empty array', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Yes!',
            },
          })
          .then([]);
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message ===
              `Arrays lengths don't match:\nExpected: 1\nActual: 0`,
        );
      }
    });
  });

  void describe('thenNothingHappened', () => {
    void it('thenNothingHappened succeeds if returns empty array', async () => {
      await given([])
        .when({
          type: 'Do',
          data: {
            something: 'Ignore!',
          },
        })
        .thenNothingHappened();
    });

    void it('thenNothingHappened fails if returns event', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Yes!',
            },
          })
          .thenNothingHappened();
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message ===
              `Array is not empty [{"type":"Did","data":{"something":"Yes!"}}]:\nExpected: 1\nActual: 0`,
        );
      }
    });

    void it('thenNothingHappened fails if returns array of events', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Array!',
            },
          })
          .thenNothingHappened();
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message ===
              `Array is not empty [{"type":"Did","data":{"something":"Array!"}}]:\nExpected: 1\nActual: 0`,
        );
      }
    });
  });

  void describe('thenThrows', () => {
    void it('check error was thrown', async () => {
      await given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows();
    });

    void it('checks error condition', async () => {
      await given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows((error) => error.message === 'Nope!');
    });

    void it('checks error type', async () => {
      await given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows(IllegalStateError);
    });

    void it('checks error type and condition', async () => {
      await given([])
        .when({
          type: 'Do',
          data: {
            something: 'Nope!',
          },
        })
        .thenThrows(IllegalStateError, (error) => error.message === 'Nope!');
    });

    void it('fails if no error was thrown', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Yes!',
            },
          })
          .thenThrows();
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message === 'Handler did not fail as expected',
        );
      }
    });

    void it('fails if wrong error type', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Nope!',
            },
          })
          .thenThrows(ValidationError);
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message.startsWith(
              'Caught error is not an instance of the expected type:',
            ),
        );
      }
    });

    void it('fails if wrong error type and correct condition', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Nope!',
            },
          })
          .thenThrows(ValidationError, (error) => error.message === 'Nope!');
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message.startsWith(
              'Caught error is not an instance of the expected type:',
            ),
        );
      }
    });

    void it('fails if correct error type but wrong correct condition', async () => {
      try {
        await given([])
          .when({
            type: 'Do',
            data: {
              something: 'Nope!',
            },
          })
          .thenThrows(IllegalStateError, (error) => error.message !== 'Nope!');
      } catch (error) {
        assertTrue(
          error instanceof AssertionError &&
            error.message ===
              `Error didn't match the error condition: Error: Nope!`,
        );
      }
    });
  });
});
