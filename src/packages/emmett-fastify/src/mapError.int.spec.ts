import {
  assertDeepEqual,
  assertEqual,
  EmmettError,
  NotFoundError,
  ProblemDocument,
} from '@event-driven-io/emmett';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it } from 'vitest';
import { getApplication, problemDetailsErrorHandler } from '.';

const applicationThrowing = (error: Error) =>
  getApplication({
    registerRoutes: (app: FastifyInstance) =>
      app.post('/bookings', () => {
        throw error;
      }),
  });

void describe('Emmett error thrown in a Fastify route', () => {
  void it('returns its status and its code in the body', async () => {
    const app = await applicationThrowing(
      new EmmettError({
        status: 409,
        message: 'Room room-1 is already booked',
        code: 'ROOM_ALREADY_BOOKED',
        details: { roomId: 'room-1' },
      }),
    );

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(409, response.statusCode);
      assertDeepEqual(response.json(), {
        statusCode: 409,
        code: 'ROOM_ALREADY_BOOKED',
        error: 'Conflict',
        message: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });

  void it('returns the status of an error created with the deprecated errorCode', async () => {
    const app = await applicationThrowing(
      new EmmettError({
        errorCode: 409,
        message: 'Room room-1 is already booked',
      }),
    );

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(409, response.statusCode);
      assertDeepEqual(response.json(), {
        statusCode: 409,
        code: 'EMT_ERR_INTERNAL',
        error: 'Conflict',
        message: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });

  void it('returns the status and the default code of a built-in Emmett error', async () => {
    const app = await applicationThrowing(
      new NotFoundError({ id: 'room-1', type: 'Room' }),
    );

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(404, response.statusCode);
      assertDeepEqual(response.json(), {
        statusCode: 404,
        code: 'EMT_ERR_NOT_FOUND',
        error: 'Not Found',
        message: 'Room with room-1 was not found during Emmett processing',
      });
    } finally {
      await app.close();
    }
  });

  void it('does not return the cause in the body', async () => {
    const app = await applicationThrowing(
      new EmmettError({
        status: 409,
        message: 'Room room-1 is already booked',
        code: 'ROOM_ALREADY_BOOKED',
        cause: new Error('db connection secret'),
      }),
    );

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(409, response.statusCode);
      assertDeepEqual(response.json(), {
        statusCode: 409,
        code: 'ROOM_ALREADY_BOOKED',
        error: 'Conflict',
        message: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });
});

// #region fastify-custom-error-mapping
class CardDeclinedError extends Error {
  constructor(public readonly code: string) {
    super(`Card declined: ${code}`);
  }
}

const checkoutApplication = () =>
  getApplication({
    registerRoutes: (app: FastifyInstance) =>
      app.post('/charges', () => {
        throw new CardDeclinedError('insufficient_funds');
      }),
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
// #endregion fastify-custom-error-mapping

const applicationWithMapErrorFallingBack = (
  registerRoutes: (app: FastifyInstance) => void,
) =>
  getApplication({
    registerRoutes,
    mapError: () => undefined,
  });

void describe('Error thrown in a Fastify route with mapError', () => {
  void it('returns the problem details returned by mapError', async () => {
    const app = await checkoutApplication();

    try {
      const response = await app.inject({ method: 'POST', url: '/charges' });

      assertEqual(402, response.statusCode);
      assertEqual(
        'application/problem+json; charset=utf-8',
        response.headers['content-type'],
      );
      assertDeepEqual(response.json(), {
        type: 'https://errors.example.com/card-declined',
        title: 'Card Declined',
        status: 402,
        detail: 'Card declined: insufficient_funds',
      });
    } finally {
      await app.close();
    }
  });

  void it('returns default problem details without code, details and cause when mapError returns undefined', async () => {
    const app = await applicationWithMapErrorFallingBack((app) =>
      app.post('/bookings', () => {
        throw new EmmettError({
          status: 409,
          message: 'Room room-1 is already booked',
          code: 'ROOM_ALREADY_BOOKED',
          details: { roomId: 'room-1' },
        });
      }),
    );

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(409, response.statusCode);
      assertEqual(
        'application/problem+json; charset=utf-8',
        response.headers['content-type'],
      );
      assertDeepEqual(response.json(), {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });

  void it('returns bad request problem details for a Fastify validation error', async () => {
    const app = await applicationWithMapErrorFallingBack((app) =>
      app.post(
        '/bookings',
        {
          schema: {
            body: {
              type: 'object',
              required: ['roomId'],
              properties: { roomId: { type: 'string' } },
            },
          },
        },
        () => ({ booked: true }),
      ),
    );

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/bookings',
        payload: {},
      });

      assertEqual(400, response.statusCode);
      assertEqual(
        'application/problem+json; charset=utf-8',
        response.headers['content-type'],
      );
      assertDeepEqual(response.json(), {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: "body must have required property 'roomId'",
      });
    } finally {
      await app.close();
    }
  });
});

void describe('problemDetailsErrorHandler set on a Fastify app', () => {
  void it('returns problem details for an error thrown in a route', async () => {
    // #region fastify-problem-details-error-handler
    const app = Fastify();
    app.setErrorHandler(problemDetailsErrorHandler());
    app.post('/bookings', () => {
      throw new EmmettError({
        status: 409,
        message: 'Room room-1 is already booked',
      });
    });
    // #endregion fastify-problem-details-error-handler

    try {
      const response = await app.inject({ method: 'POST', url: '/bookings' });

      assertEqual(409, response.statusCode);
      assertEqual(
        'application/problem+json; charset=utf-8',
        response.headers['content-type'],
      );
      assertDeepEqual(response.json(), {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });
});
