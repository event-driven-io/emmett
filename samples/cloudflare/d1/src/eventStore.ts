import { projections } from '@event-driven-io/emmett';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { d1EventStoreDriver } from '@event-driven-io/emmett-sqlite/cloudflare';
import { env } from 'cloudflare:workers';
import {
  clientShoppingCartsProjection,
  shoppingCartsProjection,
} from './shoppingCarts/projections';

export const eventStore = getSQLiteEventStore({
  driver: d1EventStoreDriver,
  database: env.DB,
  projections: projections.inline([
    shoppingCartsProjection,
    clientShoppingCartsProjection,
  ]),
  schema: {
    autoMigration:
      env.ENVIRONMENT === 'development' ? 'CreateOrUpdate' : 'None',
  },
});
