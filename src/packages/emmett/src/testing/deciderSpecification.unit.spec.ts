import { describe, it } from 'vitest';
import { IllegalStateError, ValidationError } from '../errors';
import {
  AssertionError,
  assertEqual,
  assertThrows,
} from '../testing/assertions';
import type { Command, Event } from '../typing';
import { DeciderSpecification } from './deciderSpecification';
import {
  evolve as cartEvolve,
  initialState as cartInitialState,
  removeProductItem,
  type PricedProductItem,
} from './shoppingCart.domain';

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

  void describe('then with an assertion callback', () => {
    void it('passes when the callback does not throw or return an error', () => {
      given([])
        .when({ type: 'Do', data: { something: 'Yes!' } })
        .then((events) => {
          assertEqual(events.length, 1);
          assertEqual(events[0]!.data.something, 'Yes!');
        });
    });

    void it('fails when the callback throws', () => {
      assertThrows(
        () => {
          given([])
            .when({ type: 'Do', data: { something: 'Yes!' } })
            .then(() => {
              throw new Error('assertion from client code');
            });
        },
        (error) =>
          error instanceof Error &&
          error.message === 'assertion from client code',
      );
    });

    void it('fails when the callback returns an error', () => {
      assertThrows(
        () => {
          given([])
            .when({ type: 'Do', data: { something: 'Yes!' } })
            .then(() => new Error('returned error'));
        },
        (error) => error instanceof Error && error.message === 'returned error',
      );
    });

    void it('supports async callbacks on a sync decider', async () => {
      await given([])
        .when({ type: 'Do', data: { something: 'Yes!' } })
        .then(async (events) => {
          await Promise.resolve();
          assertEqual(events.length, 1);
        });
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

const givenCart = DeciderSpecification.for({
  decide: removeProductItem,
  evolve: cartEvolve,
  initialState: cartInitialState,
});

const shoes: PricedProductItem = {
  productId: 'shoes-123',
  quantity: 1,
  price: 100,
};

void describe('DeciderSpecification with null event properties', () => {
  void it('handles system removal where removedBy is null', () => {
    givenCart([{ type: 'ProductItemAdded', data: { productItem: shoes } }])
      .when({
        type: 'RemoveProductItem',
        data: { productItem: shoes, removedBy: null },
      })
      .then([
        {
          type: 'ProductItemRemoved',
          data: { productItem: shoes, removedBy: null },
        },
      ]);
  });

  void it('handles user removal where removedBy is set', () => {
    givenCart([{ type: 'ProductItemAdded', data: { productItem: shoes } }])
      .when({
        type: 'RemoveProductItem',
        data: { productItem: shoes, removedBy: 'user-456' },
      })
      .then([
        {
          type: 'ProductItemRemoved',
          data: { productItem: shoes, removedBy: 'user-456' },
        },
      ]);
  });
});
