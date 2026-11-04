import {
  assertDeepEqual,
  assertEqual,
  EmmettError,
  ProblemDocument,
} from '@event-driven-io/emmett';
import type { Router } from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { getApplication, on } from '.';

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

const walletApi = (router: Router) =>
  router.post(
    '/withdrawals',
    on(() => {
      throw new InsufficientFundsError(100, 40);
    }),
  );

// no mapError needed: the default mapping reads the status
const application = getApplication({ apis: [walletApi] });
// #endregion derive-emmett-error

void describe('custom error aligned with Emmett', () => {
  void it('maps an EmmettError subclass by its status', async () => {
    const response = await request(application).post('/withdrawals').send();

    assertEqual(402, response.statusCode);
    assertEqual(
      'Insufficient funds: need 100, have 40',
      (response.body as ProblemDocument).detail,
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

const inventoryApi = (router: Router) =>
  router.post(
    '/reservations',
    on(() => {
      throw new OutOfStockError('shoes');
    }),
  );

const inventoryApplication = getApplication({ apis: [inventoryApi] });
// #endregion error-with-code

void describe('custom error carrying a status', () => {
  void it('maps a plain error by its status', async () => {
    const response = await request(inventoryApplication)
      .post('/reservations')
      .send();

    assertEqual(409, response.statusCode);
    assertEqual(
      'Out of stock: shoes',
      (response.body as ProblemDocument).detail,
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
          router.post(
            '/reservations',
            on(() => {
              throw new LegacyOutOfStockError('shoes');
            }),
          ),
      ],
    });

    const response = await request(legacyApplication)
      .post('/reservations')
      .send();

    assertEqual(409, response.statusCode);
    assertEqual(
      'Out of stock: shoes',
      (response.body as ProblemDocument).detail,
    );
  });
});

void describe('custom error carrying a statusCode', () => {
  void it('maps a plain error by its statusCode', async () => {
    const statusCodeApplication = getApplication({
      apis: [
        (router) =>
          router.post(
            '/reservations',
            on(() => {
              throw Object.assign(new Error('Invalid reservation'), {
                statusCode: 400,
              });
            }),
          ),
      ],
    });

    const response = await request(statusCodeApplication)
      .post('/reservations')
      .send();

    assertEqual(400, response.statusCode);
    assertEqual(
      'Invalid reservation',
      (response.body as ProblemDocument).detail,
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

  const bookingApi = (router: Router) =>
    router.post(
      '/bookings',
      on(() => {
        throw new RoomAlreadyBookedError(
          'room-1',
          new Error('Unique constraint violated'),
        );
      }),
    );

  void it('default response has no code, details or cause', async () => {
    const bookingApplication = getApplication({ apis: [bookingApi] });

    const response = await request(bookingApplication).post('/bookings').send();

    assertEqual(409, response.statusCode);
    assertDeepEqual(response.body, {
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

    const response = await request(bookingApplication).post('/bookings').send();

    assertEqual(409, response.statusCode);
    assertDeepEqual(response.body, {
      detail: 'Room room-1 is already booked',
      status: 409,
      title: 'Conflict',
      type: 'about:blank',
      code: 'ROOM_ALREADY_BOOKED',
      details: { roomId: 'room-1' },
    });
  });

  void it('mapError adds the cause code to the response', async () => {
    const conflictingBookingApi = (router: Router) =>
      router.post(
        '/bookings',
        on(() => {
          throw new RoomAlreadyBookedError(
            'room-1',
            new EmmettError({
              status: 412,
              message: 'Stream booking-room-1 expected version 3, got 4',
              code: 'STREAM_VERSION_CONFLICT',
            }),
          );
        }),
      );

    // #region map-error-cause
    const bookingApplication = getApplication({
      apis: [conflictingBookingApi],
      mapError: (error) =>
        error instanceof EmmettError
          ? new ProblemDocument(
              { status: error.status, detail: error.message },
              {
                code: error.code,
                details: error.details ?? {},
                cause:
                  error.cause instanceof EmmettError
                    ? { code: error.cause.code }
                    : undefined,
              },
            )
          : undefined,
    });
    // #endregion map-error-cause

    const response = await request(bookingApplication).post('/bookings').send();

    assertEqual(409, response.statusCode);
    assertDeepEqual(response.body, {
      detail: 'Room room-1 is already booked',
      status: 409,
      title: 'Conflict',
      type: 'about:blank',
      code: 'ROOM_ALREADY_BOOKED',
      details: { roomId: 'room-1' },
      cause: { code: 'STREAM_VERSION_CONFLICT' },
    });
    assertEqual(false, response.text.includes('expected version'));
    assertEqual(false, response.text.includes('stack'));
  });
});

void describe('mapping a foreign error', () => {
  void it('maps a third-party error with mapError', async () => {
    const response = await request(checkoutApplication).post('/charges').send();

    assertEqual(402, response.statusCode);
    assertEqual('Card Declined', (response.body as ProblemDocument).title);
  });
});

void describe('default error mapping', () => {
  void it('maps a non-Error rejected by an async handler', async () => {
    const rejectedValueApplication = getApplication({
      apis: [
        (router) => {
          router.get('/string-error', async () => {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            await Promise.reject('Async rejection');
          });
        },
      ],
    });

    const response = await request(rejectedValueApplication)
      .get('/string-error')
      .send();

    assertEqual(500, response.statusCode);
    assertEqual('Async rejection', (response.body as ProblemDocument).detail);
  });
});
