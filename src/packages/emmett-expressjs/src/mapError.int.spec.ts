import { assertEqual } from '@event-driven-io/emmett';
import type { Router } from 'express';
import { ProblemDocument } from 'http-problem-details';
import request from 'supertest';
import { describe, it } from 'vitest';
import { getApplication, on } from '.';

class InsufficientFundsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Insufficient funds: need ${required}, have ${available}`);
  }
}

const walletApi = (router: Router) =>
  router.post(
    '/withdrawals',
    on(() => {
      throw new InsufficientFundsError(100, 40);
    }),
  );

// #region custom-error-mapping
const application = getApplication({
  apis: [walletApi],
  // return a ProblemDocument to override the mapping,
  // or undefined to keep Emmett's default
  mapError: (error) =>
    error instanceof InsufficientFundsError
      ? new ProblemDocument({
          type: 'https://errors.example.com/insufficient-funds',
          status: 402,
          title: 'Insufficient Funds',
          detail: error.message,
        })
      : undefined,
});
// #endregion custom-error-mapping

void describe('custom error mapping', () => {
  void it('maps a custom error to the Problem Details it returns', async () => {
    const response = await request(application).post('/withdrawals').send();

    assertEqual(response.statusCode, 402);
    assertEqual((response.body as ProblemDocument).title, 'Insufficient Funds');
  });
});
