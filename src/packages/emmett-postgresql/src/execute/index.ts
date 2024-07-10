import type pg from 'pg';
import { type SQL } from '../sql';

export const execute = async <Result = void>(
  pool: pg.Pool,
  handle: (client: pg.PoolClient) => Promise<Result>,
) => {
  const client = await pool.connect();
  try {
    return await handle(client);
  } finally {
    client.release();
  }
};

export const executeInTransaction = async <Result = void>(
  pool: pg.Pool,
  handle: (client: pg.PoolClient) => Promise<Result>,
) =>
  execute(pool, async (client) => {
    try {
      await client.query('BEGIN');

      const result = handle(client);

      await client.query('COMMIT');

      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

export const executeSQL = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  pool: pg.Pool,
  sql: SQL,
): Promise<pg.QueryResult<Result>> =>
  execute(pool, (client) => client.query<Result>(sql));

export const executeSQLInTransaction = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  pool: pg.Pool,
  ...sqls: SQL[]
) =>
  executeInTransaction(pool, async (client) => {
    for (const sql of sqls) await client.query<Result>(sql);
  });
