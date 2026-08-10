import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  getInMemoryEventStore,
} from '@event-driven-io/emmett';
import express from 'express';
import type { Application } from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { configureApplication } from '..';
import type { ShoppingCartEvent } from './decider/shoppingCart';
import { shoppingCartApi } from './commandHandler/api';

void describe('configureApplication E2E', () => {
  void it('keeps existing routes and adds the shopping cart API', async () => {
    const eventStore = getInMemoryEventStore();
    const clientId = 'client-123';
    const shoppingCarts = shoppingCartApi(eventStore);

    // #region configure-existing-application
    const existingApplication = express();

    existingApplication.get('/health', (_request, response) => {
      response.status(200).json({ status: 'ok' });
    });

    const configuredApplication: Application = configureApplication(
      existingApplication,
      {
        apis: [shoppingCarts],
      },
    );
    // #endregion configure-existing-application

    assertOk(configuredApplication === existingApplication);

    const healthResponse = await request(configuredApplication)
      .get('/health')
      .send();

    assertEqual(healthResponse.statusCode, 200);
    assertDeepEqual(healthResponse.body, { status: 'ok' });

    const createCartResponse = await request(configuredApplication)
      .post(`/clients/${clientId}/shopping-carts/`)
      .send();

    assertEqual(createCartResponse.statusCode, 201);

    const result = await eventStore.readStream<ShoppingCartEvent>(clientId);

    assertDeepEqual(
      result.events.map((event) => event.type),
      ['ShoppingCartOpened'],
    );
  });
});
