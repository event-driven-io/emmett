import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { endPgPool } from '@event-driven-io/dumbo/pg';

declare module 'vitest' {
  export interface ProvidedContext {
    sharedPostgreSQLConnectionString: string;
  }
}

export type PostgreSQLTestDatabase = {
  connectionString: string;
  close: () => Promise<void>;
};

const withDatabaseName = (
  serverConnectionString: string,
  databaseName: string,
): string => {
  const url = new URL(serverConnectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const onServer = async <Result>(
  handle: (client: pg.Client) => Promise<Result>,
): Promise<Result> => {
  const client = new pg.Client({
    connectionString: inject('sharedPostgreSQLConnectionString'),
  });
  await client.connect();

  try {
    return await handle(client);
  } finally {
    await client.end();
  }
};

/**
 * Gives the calling spec file its own database on the container shared by the
 * whole run. Creating a database costs milliseconds; starting a container costs
 * seconds, and starting one per file starts a dozen at once.
 *
 * Not for every spec: see {@link isolatedPostgreSQLDatabase}.
 */
export const sharedPostgreSQLDatabase =
  async (): Promise<PostgreSQLTestDatabase> => {
    const databaseName = `emmett_test_${randomUUID().replaceAll('-', '')}`;

    await onServer((client) =>
      client.query(`CREATE DATABASE "${databaseName}"`),
    );

    const connectionString = withDatabaseName(
      inject('sharedPostgreSQLConnectionString'),
      databaseName,
    );

    return {
      connectionString,
      close: async () => {
        await endPgPool({ connectionString, force: true });

        await onServer(async (client) => {
          await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        });
      },
    };
  };

/**
 * A whole container to itself, for the specs a separate database cannot
 * isolate. Our reads gate on `pg_snapshot_xmin(pg_current_snapshot())`, and
 * that horizon is held back by any open transaction anywhere in the cluster,
 * including in another database. So a spec that deliberately holds a
 * transaction open, or that asserts on when a commit becomes visible, both
 * disturbs and is disturbed by whatever else runs beside it.
 */
export const isolatedPostgreSQLDatabase =
  async (): Promise<PostgreSQLTestDatabase> => {
    const container = await getPostgreSQLStartedContainer();

    return {
      connectionString: container.getConnectionUri(),
      close: async () => {
        await container.stop();
      },
    };
  };
