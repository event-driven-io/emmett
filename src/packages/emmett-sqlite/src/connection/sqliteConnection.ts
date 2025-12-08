import libsql from 'libsql';

export type Parameters = object | string | bigint | number | boolean | null;

export type SQLiteConnection = {
  close: () => void;
  command: (sql: string, values?: Parameters[]) => Promise<libsql.RunResult>;
  query: <T>(sql: string, values?: Parameters[]) => Promise<T[]>;
  querySingle: <T>(sql: string, values?: Parameters[]) => Promise<T | null>;
  withTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
};

export interface SQLiteError extends Error {
  errno: number;
}

export const isSQLiteError = (error: unknown): error is SQLiteError => {
  if (error instanceof Error && 'code' in error) {
    return true;
  }

  return false;
};

export type InMemorySharedCacheSQLiteDatabase = 'file::memory:?cache=shared';
export const InMemorySharedCacheSQLiteDatabase = 'file::memory:?cache=shared';
export type InMemorySQLiteDatabase = ':memory:';
export const InMemorySQLiteDatabase = ':memory:';

type SQLiteConnectionOptions = {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  fileName: InMemorySQLiteDatabase | string | undefined;
};

export const sqliteConnection = (
  options: SQLiteConnectionOptions,
): SQLiteConnection => {
  const fileName = options.fileName ?? InMemorySQLiteDatabase;
  const db = new libsql(fileName);
  db.pragma('journal_mode = WAL');

  return {
    close: (): void => {
      db.close();
    },
    command: (sql: string, params?: Parameters[]) =>
      new Promise<libsql.RunResult>((resolve, reject) => {
        try {
          const stmt = db.prepare(sql);
          params = normalizeParams(params);
          const res = stmt.run(params ?? []);
          resolve(res);
        } catch (err) {
          reject(err as Error);
        }
      }),
    query: <T>(sql: string, params?: Parameters[]): Promise<T[]> =>
      new Promise((resolve, reject) => {
        try {
          const stmt = db.prepare(sql);
          params = normalizeParams(params);
          const res =
            (stmt.all(params ?? []) as { _metadata: unknown }[])?.map(
              ({ _metadata, ...o }) => o,
            ) || [];
          resolve(res as T[]);
        } catch (err) {
          reject(err as Error);
        }
      }),
    querySingle: <T>(sql: string, params?: Parameters[]): Promise<T | null> =>
      new Promise((resolve, reject) => {
        try {
          const stmt = db.prepare(sql);
          params = normalizeParams(params);
          let res: T;
          const o = stmt.get(params ?? []) as
            | {
                _metadata: unknown;
              }
            | undefined;
          if (o) {
            const { _metadata, ...r } = o;
            res = r as T;
          }
          resolve(res!);
        } catch (err) {
          reject(err as Error);
        }
      }),
    withTransaction: <T>(fn: () => Promise<T>) => db.transaction(fn)(),
  };
};

const normalizeParams = (params?: Parameters[]) =>
  params?.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)) ?? [];
