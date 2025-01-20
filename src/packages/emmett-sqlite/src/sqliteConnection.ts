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

export type AbsolutePath = `/${string}`;
export type RelativePath = `${'.' | '..'}/${string}`;

type SQLiteConnectionOptions =
  | {
      conn: sqlite3.Database;
      location?: never;
    }
  | {
      conn?: never;
      location: AbsolutePath | RelativePath | ':memory:';
    };
export const sqliteConnection = (
  options: SQLiteConnectionOptions,
): SQLiteConnection => {
  let db: sqlite3.Database;

  if (options.conn != null) {
    db = options.conn;
  } else {
    if (typeof options.location !== 'string') {
      throw new Error('Path for sqlite database must be given');
    }
    db = new sqlite3.Database(options.location);
  }

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
