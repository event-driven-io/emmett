import {
  ConcurrencyError,
  UniqueConstraintError,
} from '@event-driven-io/dumbo';
import {
  assertEqual,
  assertFalse,
  assertTrue,
  defaultErrorToProblemDetailsMapping,
  EmmettError,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';

void describe('Dumbo UniqueConstraintError in Emmett', () => {
  const innerError = new Error(
    'duplicate key value violates unique constraint',
  );
  const dumboError = new UniqueConstraintError(
    'Shopping cart already exists',
    innerError,
  );

  void it('maps to an Emmett error with conflict status, message, cause and stack', () => {
    const error = EmmettError.mapFrom(dumboError);

    assertTrue(error instanceof EmmettError);
    assertEqual(409, error.status);
    assertEqual('Shopping cart already exists', error.message);
    assertEqual(innerError, error.cause);
    assertEqual(dumboError.stack, error.stack);
  });

  void it('maps to an Emmett error with the Dumbo unique constraint code', () => {
    const error = EmmettError.mapFrom(dumboError);

    assertEqual('DMB_ERR_UNIQUE_CONSTRAINT', error.code);
  });

  void it('is recognised as an Emmett error with conflict status', () => {
    assertTrue(EmmettError.isInstanceOf(dumboError, 409));
    assertFalse(
      EmmettError.isInstanceOf(dumboError, EmmettError.Codes.ConcurrencyError),
    );
  });

  void it('maps to problem details with conflict status', () => {
    const problem = defaultErrorToProblemDetailsMapping(dumboError);

    assertEqual(409, problem.status);
    assertEqual('Shopping cart already exists', problem.detail);
  });
});

void describe('Dumbo ConcurrencyError in Emmett', () => {
  const innerError = new Error('could not serialize access');
  const dumboError = new ConcurrencyError(
    'Shopping cart was changed by someone else',
    innerError,
  );

  void it('maps to an Emmett error with concurrency status, message, cause and stack', () => {
    const error = EmmettError.mapFrom(dumboError);

    assertTrue(error instanceof EmmettError);
    assertEqual(EmmettError.Codes.ConcurrencyError, error.status);
    assertEqual('Shopping cart was changed by someone else', error.message);
    assertEqual(innerError, error.cause);
    assertEqual(dumboError.stack, error.stack);
  });

  void it('is recognised as an Emmett concurrency error', () => {
    assertTrue(
      EmmettError.isInstanceOf(dumboError, EmmettError.Codes.ConcurrencyError),
    );
    assertFalse(
      EmmettError.isInstanceOf(dumboError, EmmettError.Codes.NotFoundError),
    );
  });

  void it('maps to problem details with concurrency status', () => {
    const problem = defaultErrorToProblemDetailsMapping(dumboError);

    assertEqual(EmmettError.Codes.ConcurrencyError, problem.status);
    assertEqual('Shopping cart was changed by someone else', problem.detail);
  });
});
