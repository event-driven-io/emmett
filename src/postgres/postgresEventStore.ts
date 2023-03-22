import { EventStore } from 'src/eventStore';
import { Pool, PoolClient, PoolConfig } from 'pg';

export type PostgresEventStoreOptions = {
  type: 'postgres';
  poolConfig?: PoolConfig;
};

type Pong = { pong: 'pong' };

const isPong = (obj: unknown): obj is Pong => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'pong' in obj &&
    obj.pong == 'pong'
  );
};

const query = async <Result>(
  pool: Pool,
  get: (client: PoolClient) => Promise<Result>
): Promise<Result> => {
  let client: PoolClient | undefined = undefined;
  try {
    client = await pool.connect();

    return get(client);
  } finally {
    client?.release();
  }
};

const ping = (pool: Pool): Promise<'pong'> =>
  query(pool, async (client) => {
    const result = await client.query("SELECT 'pong' as pong");

    if (result.rowCount !== 1 || !isPong(result.rows[0]))
      throw new Error('Failed');

    return result.rows[0].pong;
  });

export const getPostgresEventStore = ({
  poolConfig,
}: PostgresEventStoreOptions): EventStore => {
  const pool = new Pool(poolConfig);

  return {
    type: 'postgres',
    init: async () => {
      await query(pool, (client) => client.query('SELECT NOW()'));
    },
    diagnostics: {
      ping: () => ping(pool),
    },
  };
};
