/* eslint-disable @typescript-eslint/no-unused-vars */
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

// #region getting-started-api-setup
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://localhost:5432/postgres';

const eventStore = getPostgreSQLEventStore(connectionString);

const shoppingCarts = shoppingCartApi(
  eventStore,
  getUnitPrice,
  () => new Date(),
);
// #endregion getting-started-api-setup
