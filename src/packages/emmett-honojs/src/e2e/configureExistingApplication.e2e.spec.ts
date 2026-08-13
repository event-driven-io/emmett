import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  getInMemoryEventStore,
} from '@event-driven-io/emmett';
import { Hono } from 'hono';
import { describe, it } from 'vitest';
import { configureApplication } from '..';
import { shoppingCartApi } from './decider/api';
import type { ShoppingCartEvent } from './decider/shoppingCart';

void describe('configureApplication E2E', () => {
  void it('keeps existing routes and adds the shopping cart API', async () => {
    const eventStore = getInMemoryEventStore();
    const clientId = 'client-123';
    const shoppingCarts = shoppingCartApi(eventStore);

    // #region configure-existing-application
    const existingApplication = new Hono();

    existingApplication.get('/health', (context) => {
      return context.json({ status: 'ok' });
    });

    const configuredApplication: Hono = configureApplication(
      existingApplication,
      {
        apis: [shoppingCarts],
      },
    );
    // #endregion configure-existing-application

    assertOk(configuredApplication === existingApplication);

    const healthResponse = await configuredApplication.request('/health');

    assertEqual(healthResponse.status, 200);
    assertDeepEqual(await healthResponse.json(), { status: 'ok' });

    const createCartResponse = await configuredApplication.request(
      `/clients/${clientId}/shopping-carts/`,
      { method: 'POST' },
    );

    assertEqual(createCartResponse.status, 201);

    const result = await eventStore.readStream<ShoppingCartEvent>(clientId);

    assertDeepEqual(
      result.events.map((event) => event.type),
      ['ShoppingCartOpened'],
    );
  });
});
