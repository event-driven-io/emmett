import {
  assertDeepEqual,
  assertEqual,
  EmmettError,
  ProblemDocument,
} from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { getApplication, type WebApiSetup } from '.';

// #region derive-emmett-error
// derive from EmmettError so the error carries its HTTP status
class InsufficientFundsError extends EmmettError {
  constructor(required: number, available: number) {
    super({
      status: 402,
      message: `Insufficient funds: need ${required}, have ${available}`,
    });
  }
}

const walletApi: WebApiSetup = (router) =>
  router.post('/withdrawals', () => {
    throw new InsufficientFundsError(100, 40);
  });

// no mapError needed: the default mapping reads the status
const application = getApplication({ apis: [walletApi] });
// #endregion derive-emmett-error

void describe('custom error aligned with Emmett', () => {
  void it('maps an EmmettError subclass by its status', async () => {
    const response = await application.request('/withdrawals', {
      method: 'POST',
    });

    assertEqual(402, response.status);
    assertEqual(
      'Insufficient funds: need 100, have 40',
      ((await response.json()) as ProblemDocument).detail,
    );
  });
});

// #region error-with-code
// or skip the base class: the default mapping reads any numeric status
class OutOfStockError extends Error {
  public readonly status = 409;

  constructor(productId: string) {
    super(`Out of stock: ${productId}`);
  }
}

const inventoryApi: WebApiSetup = (router) =>
  router.post('/reservations', () => {
    throw new OutOfStockError('shoes');
  });

const inventoryApplication = getApplication({ apis: [inventoryApi] });
// #endregion error-with-code

void describe('custom error carrying a status', () => {
  void it('maps a plain error by its status', async () => {
    const response = await inventoryApplication.request('/reservations', {
      method: 'POST',
    });

    assertEqual(409, response.status);
    assertEqual(
      'Out of stock: shoes',
      ((await response.json()) as ProblemDocument).detail,
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

const checkoutApi: WebApiSetup = (router) =>
  router.post('/charges', () => {
    throw new CardDeclinedError('insufficient_funds');
  });

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

void describe('custom error carrying a deprecated errorCode', () => {
  void it('maps a plain error by its errorCode', async () => {
    class LegacyOutOfStockError extends Error {
      public readonly errorCode = 409;

      constructor(productId: string) {
        super(`Out of stock: ${productId}`);
      }
    }

    const legacyApplication = getApplication({
      apis: [
        (router) =>
          router.post('/reservations', () => {
            throw new LegacyOutOfStockError('shoes');
          }),
      ],
    });

    const response = await legacyApplication.request('/reservations', {
      method: 'POST',
    });

    assertEqual(409, response.status);
    assertEqual(
      'Out of stock: shoes',
      ((await response.json()) as ProblemDocument).detail,
    );
  });
});

void describe('custom error carrying a statusCode', () => {
  void it('maps a plain error by its statusCode', async () => {
    const statusCodeApplication = getApplication({
      apis: [
        (router) =>
          router.post('/orders', () => {
            throw Object.assign(new Error('Order is invalid'), {
              statusCode: 400,
            });
          }),
      ],
    });

    const response = await statusCodeApplication.request('/orders', {
      method: 'POST',
    });

    assertEqual(400, response.status);
    assertEqual(
      'Order is invalid',
      ((await response.json()) as ProblemDocument).detail,
    );
  });
});

void describe('custom error with code and details', () => {
  // #region error-with-code-and-details
  class RoomAlreadyBookedError extends EmmettError {
    constructor(roomId: string, cause?: unknown) {
      super({
        status: 409,
        message: `Room ${roomId} is already booked`,
        code: 'ROOM_ALREADY_BOOKED',
        details: { roomId },
        cause,
      });
    }
  }
  // #endregion error-with-code-and-details

  const bookingApi: WebApiSetup = (router) =>
    router.post('/bookings', () => {
      throw new RoomAlreadyBookedError(
        'room-1',
        new Error('Unique constraint violated'),
      );
    });

  void it('default response has no code, details or cause', async () => {
    const bookingApplication = getApplication({ apis: [bookingApi] });

    const response = await bookingApplication.request('/bookings', {
      method: 'POST',
    });

    assertEqual(409, response.status);
    assertDeepEqual(await response.json(), {
      detail: 'Room room-1 is already booked',
      status: 409,
      title: 'Conflict',
      type: 'about:blank',
    });
  });

  void it('mapError adds code and details to the response', async () => {
    // #region map-error-code-and-details
    const bookingApplication = getApplication({
      apis: [bookingApi],
      // expose only what the client needs; never send cause
      mapError: (error) =>
        error instanceof EmmettError
          ? new ProblemDocument(
              { status: error.status, detail: error.message },
              { code: error.code, details: error.details ?? {} },
            )
          : undefined,
    });
    // #endregion map-error-code-and-details

    const response = await bookingApplication.request('/bookings', {
      method: 'POST',
    });

    assertEqual(409, response.status);
    assertDeepEqual(await response.json(), {
      detail: 'Room room-1 is already booked',
      status: 409,
      title: 'Conflict',
      type: 'about:blank',
      code: 'ROOM_ALREADY_BOOKED',
      details: { roomId: 'room-1' },
    });
  });
});

void describe('mapping a foreign error', () => {
  void it('maps a third-party error with mapError', async () => {
    const response = await checkoutApplication.request('/charges', {
      method: 'POST',
    });

    assertEqual(402, response.status);
    assertEqual(
      'Card Declined',
      ((await response.json()) as ProblemDocument).title,
    );
  });
});
