import { EventStore } from '../eventStore';
import { Pool, PoolClient, PoolConfig } from 'pg';
import { ConnectionWrapper } from '../shared/lifetime';

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

type PostgresConnection = ConnectionWrapper<Pool>;

const getPostgresConnection = ({
  poolConfig,
}: PostgresEventStoreOptions): PostgresConnection => {
  const pool = new Pool(poolConfig);

  return ConnectionWrapper(pool, () => pool.end());
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

export const getPostgresEventStore = (
  options: PostgresEventStoreOptions
): EventStore => {
  const connection = getPostgresConnection(options);

  return {
    type: 'postgres',
    init: async () => {
      await query(connection.db(), (client) => client.query('SELECT NOW()'));
    },
    close: connection.close,
    diagnostics: {
      ping: async () => ping(connection.db()),
    },
  };
};
