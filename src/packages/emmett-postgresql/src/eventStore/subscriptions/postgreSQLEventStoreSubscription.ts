import { dumbo, type PostgresConnection } from '@event-driven-io/dumbo';

export type PostgreSQLEventStoreSubscription = {
  isRunning: boolean;
  subscribe: () => Promise<void>;
  stop: () => Promise<void>;
};

export type PostgreSQLEventStoreSubscriptionOptions = {
  connectionString: string;
};

export const postgreSQLEventStoreSubscription = (
  options: PostgreSQLEventStoreSubscriptionOptions,
): PostgreSQLEventStoreSubscription => {
  let isRunning = false;

  const { connectionString } = options;
  const pool = dumbo({ connectionString });
  let connection: PostgresConnection;

  let subscribe: Promise<void>;

  return {
    get isRunning() {
      return isRunning;
    },
    subscribe: () => {
      subscribe = (async () => {
        connection = await pool.connection();
        await connection.open();
        isRunning = true;
      })();

      return subscribe;
    },
    stop: async () => {
      await subscribe;
      if (connection) await connection.close();
      await pool.close();
      isRunning = false;
    },
  };
};
