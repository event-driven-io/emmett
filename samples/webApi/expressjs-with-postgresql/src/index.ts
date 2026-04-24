import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pongoClient } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import type { Application } from 'express';
import pino from 'pino';
import { observability } from './register';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres:postgres@localhost:5432/postgres';

const logger = pino();

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline(shoppingCarts.projections),
  schema: { autoMigration: 'None' },
});

await eventStore.schema.migrate();

const readStore = pongoClient({ connectionString, driver: pgDriver });

const inMemoryMessageBus = getInMemoryMessageBus();

// dummy example to show subscription
inMemoryMessageBus.subscribe((event: ShoppingCartConfirmed) => {
  logger.info({ event }, 'Shopping Cart confirmed');
}, 'ShoppingCartConfirmed');

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const application: Application = getApplication({
  apis: [
    shoppingCarts.api(
      eventStore,
      readStore.db(),
      inMemoryMessageBus,
      getUnitPrice,
      () => new Date(),
    ),
  ],
  observability: observability as import('@event-driven-io/almanac').ObservabilityConfig,
});

startAPI(application);
