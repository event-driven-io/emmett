import { EventStore } from 'src/eventStore';
import { Pool, PoolConfig } from 'pg';

export type PostgresEventStoreOptions = {
  type: 'postgres';
  poolConfig?: PoolConfig;
};

export const getPostgresEventStore = ({
  poolConfig,
}: PostgresEventStoreOptions): EventStore => {
  const pool = new Pool(poolConfig);

  return {
    init: async () => {
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();
    },
  };
};
