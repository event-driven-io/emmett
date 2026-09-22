import { getApplication } from '@event-driven-io/emmett-honojs';
import { env } from 'cloudflare:workers';
import { eventStore } from './eventStore';
import { migrationsApi } from './migrations';
import { pongoDb } from './pongo';
import { getUnitPrice, shoppingCartApi } from './shoppingCarts';

export default getApplication({
  apis: [
    migrationsApi({ eventStore, migrationToken: env.MIGRATION_TOKEN }),
    shoppingCartApi({
      eventStore,
      pongoDb,
      getUnitPrice,
      getCurrentTime: () => new Date(),
    }),
  ],
});
