import {
  assertDeepEqual,
  assertEqual,
  EmmettError,
} from '@event-driven-io/emmett';
import type { FastifyInstance } from 'fastify';
import { describe, it } from 'vitest';
import { getApplication } from '.';

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
        error: 'Conflict',
        message: 'Room room-1 is already booked',
      });
    } finally {
      await app.close();
    }
  });
});
