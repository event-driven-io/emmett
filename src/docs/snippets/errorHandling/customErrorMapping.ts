/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  getApplication,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import { ProblemDocument } from 'http-problem-details';

const shoppingCartApi: WebApiSetup = (_router) => {};

// #region custom-error-mapping
class InsufficientFundsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Insufficient funds: need ${required}, have ${available}`);
  }
}

const application = getApplication({
  apis: [shoppingCartApi],
  // return a ProblemDocument to override the mapping,
  // or undefined to keep Emmett's default
  mapError: (error) =>
    error instanceof InsufficientFundsError
      ? new ProblemDocument({
          status: 402,
          title: 'Insufficient Funds',
          detail: error.message,
        })
      : undefined,
});
// #endregion custom-error-mapping
