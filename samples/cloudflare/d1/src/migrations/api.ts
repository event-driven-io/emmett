import type { SQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { NoContent, type WebApiSetup } from '@event-driven-io/emmett-honojs';

type MigrationsApiDependencies = {
  eventStore: SQLiteEventStore;
  migrationToken?: string;
};

export const migrationsApi =
  ({ eventStore, migrationToken }: MigrationsApiDependencies): WebApiSetup =>
  (router) => {
    router.post('/_system/migrations', async (context) => {
      if (
        !migrationToken ||
        context.req.header('Authorization') !== `Bearer ${migrationToken}`
      )
        return context.body(null, 401);

      await eventStore.schema.migrate();

      return NoContent({ context });
    });
  };
