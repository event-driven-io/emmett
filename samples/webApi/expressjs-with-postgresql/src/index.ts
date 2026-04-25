import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pongoClient } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import { context, trace } from '@opentelemetry/api';
import express, { type Application } from 'express';
import pino from 'pino';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';
import { readFileSync } from 'node:fs';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { name: string };

const logger = pino(
  pino.transport({
    target: 'pino-opentelemetry-transport',
    options: {
      resourceAttributes: { 'service.name': pkg.name },
    },
  }),
);

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
});

const server = express();

server.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'expressjs-with-postgresql' });
});

server.use((_req, res, next) => {
  const traceId = trace.getSpan(context.active())?.spanContext()?.traceId;
  if (traceId) res.setHeader('x-trace-id', traceId);
  next();
});
server.use(application);

startAPI(server);
