import sqlite3 from 'sqlite3';

export type Parameters = object | string | bigint | number | boolean | null;

export type SQLiteConnection = {
  close: () => void;
  command: (sql: string, values?: Parameters[]) => Promise<void>;
  query: <T>(sql: string, values?: Parameters[]) => Promise<T[]>;
  querySingle: <T>(sql: string, values?: Parameters[]) => Promise<T | null>;
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

export type InMemorySQLiteDatabase = ':memory:';
export const InMemorySQLiteDatabase = ':memory:';

type SQLiteConnectionOptions = {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  fileName: InMemorySQLiteDatabase | string | undefined;
};

export const sqliteConnection = (
  options: SQLiteConnectionOptions,
): SQLiteConnection => {
  const db = new sqlite3.Database(options.fileName ?? InMemorySQLiteDatabase);

  return {
    close: (): void => db.close(),
    command: (sql: string, params?: Parameters[]) =>
      new Promise((resolve, reject) => {
        db.run(sql, params ?? [], (err: Error | null) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      }),
    query: <T>(sql: string, params?: Parameters[]): Promise<T[]> =>
      new Promise((resolve, reject) => {
        db.all(sql, params ?? [], (err: Error | null, result: T[]) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(result);
        });
      }),
    querySingle: <T>(sql: string, params?: Parameters[]): Promise<T | null> =>
      new Promise((resolve, reject) => {
        db.get(sql, params ?? [], (err: Error | null, result: T | null) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(result);
        });
      }),
  };
};
