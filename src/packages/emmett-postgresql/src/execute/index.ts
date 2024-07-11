import { EmmettError } from '@event-driven-io/emmett';
import type pg from 'pg';
import type { SQL } from '../sql';

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
): Promise<Result> =>
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
  sql: SQL,
) => {
  console.log(sql);
  return executeInTransaction(pool, (client) => client.query<Result>(sql));
};

export const executeSQLBatchInTransaction = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  pool: pg.Pool,
  ...sqls: SQL[]
) =>
  executeInTransaction(pool, async (client) => {
    for (const sql of sqls) {
      await client.query<Result>(sql);
    }
  });

export const firstOrNull = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  getResult: Promise<pg.QueryResult<Result>>,
): Promise<Result | null> => {
  const result = await getResult;

  return result.rows.length > 0 ? result.rows[0] ?? null : null;
};

export const first = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  getResult: Promise<pg.QueryResult<Result>>,
): Promise<Result> => {
  const result = await getResult;

  if (result.rows.length === 0)
    throw new EmmettError("Query didn't return any result");

  return result.rows[0]!;
};

export const singleOrNull = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  getResult: Promise<pg.QueryResult<Result>>,
): Promise<Result | null> => {
  const result = await getResult;

  if (result.rows.length > 1)
    throw new EmmettError('Query had more than one result');

  return result.rows.length > 0 ? result.rows[0] ?? null : null;
};

export const single = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
>(
  getResult: Promise<pg.QueryResult<Result>>,
): Promise<Result> => {
  const result = await getResult;

  if (result.rows.length === 0)
    throw new EmmettError("Query didn't return any result");

  if (result.rows.length > 1)
    throw new EmmettError('Query had more than one result');

  return result.rows[0]!;
};

export const mapRow = async <
  Result extends pg.QueryResultRow = pg.QueryResultRow,
  Mapped = unknown,
>(
  getResult: Promise<pg.QueryResult<Result>>,
  map: (row: Result) => Mapped,
): Promise<Mapped[]> => {
  const result = await getResult;

  return result.rows.map(map);
};

export type ExistsSQLQueryResult = { exists: boolean };

export const exists = async (pool: pg.Pool, sql: SQL): Promise<boolean> => {
  const result = await single(executeSQL<ExistsSQLQueryResult>(pool, sql));

  return result.exists === true;
};
