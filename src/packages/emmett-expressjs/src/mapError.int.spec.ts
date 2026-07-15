import { assertEqual, EmmettError } from '@event-driven-io/emmett';
import type { Router } from 'express';
import { ProblemDocument } from 'http-problem-details';
import request from 'supertest';
import { describe, it } from 'vitest';
import { getApplication, on } from '.';

// #region derive-emmett-error
// derive from EmmettError so the error carries its HTTP status
class InsufficientFundsError extends EmmettError {
  constructor(required: number, available: number) {
    super({
      errorCode: 402,
      message: `Insufficient funds: need ${required}, have ${available}`,
    });
  }
}

const walletApi = (router: Router) =>
  router.post(
    '/withdrawals',
    on(() => {
      throw new InsufficientFundsError(100, 40);
    }),
  );

// no mapError needed: the default mapping reads the errorCode
const application = getApplication({ apis: [walletApi] });
// #endregion derive-emmett-error

void describe('custom error aligned with Emmett', () => {
  void it('maps an EmmettError subclass by its errorCode', async () => {
    const response = await request(application).post('/withdrawals').send();

    assertEqual(response.statusCode, 402);
    assertEqual(
      (response.body as ProblemDocument).detail,
      'Insufficient funds: need 100, have 40',
    );
  });
});

// #region error-with-code
// or skip the base class: the default mapping reads any numeric errorCode
class OutOfStockError extends Error {
  public readonly errorCode = 409;

  constructor(productId: string) {
    super(`Out of stock: ${productId}`);
  }
}

const inventoryApi = (router: Router) =>
  router.post(
    '/reservations',
    on(() => {
      throw new OutOfStockError('shoes');
    }),
  );

const inventoryApplication = getApplication({ apis: [inventoryApi] });
// #endregion error-with-code

void describe('custom error carrying an errorCode', () => {
  void it('maps a plain error by its errorCode', async () => {
    const response = await request(inventoryApplication)
      .post('/reservations')
      .send();

    assertEqual(response.statusCode, 409);
    assertEqual(
      (response.body as ProblemDocument).detail,
      'Out of stock: shoes',
    );
  });
});

// #region custom-error-mapping
// an error from a library you do not control
class CardDeclinedError extends Error {
  constructor(public readonly code: string) {
    super(`Card declined: ${code}`);
  }
}

const checkoutApi = (router: Router) =>
  router.post(
    '/charges',
    on(() => {
      throw new CardDeclinedError('insufficient_funds');
    }),
  );

const checkoutApplication = getApplication({
  apis: [checkoutApi],
  // translate a foreign error into Problem Details;
  // return undefined to fall back to the default mapping
  mapError: (error) =>
    error instanceof CardDeclinedError
      ? new ProblemDocument({
          type: 'https://errors.example.com/card-declined',
          status: 402,
          title: 'Card Declined',
          detail: error.message,
        })
      : undefined,
});
// #endregion custom-error-mapping

void describe('mapping a foreign error', () => {
  void it('maps a third-party error with mapError', async () => {
    const response = await request(checkoutApplication).post('/charges').send();

    assertEqual(response.statusCode, 402);
    assertEqual((response.body as ProblemDocument).title, 'Card Declined');
  });
});
