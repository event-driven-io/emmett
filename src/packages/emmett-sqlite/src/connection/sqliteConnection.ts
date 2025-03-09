import sqlite3 from 'sqlite3';

export type Parameters = object | string | bigint | number | boolean | null;

export type SQLiteConnection = {
  close: () => void;
  command: (sql: string, values?: Parameters[]) => Promise<sqlite3.RunResult>;
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
  let db: sqlite3.Database;

  if (fileName === InMemorySharedCacheSQLiteDatabase) {
    db = new sqlite3.Database(fileName, sqlite3.OPEN_URI);
  } else {
    db = new sqlite3.Database(fileName);
  }

  return {
    close: (): void => db.close(),
    command: (sql: string, params?: Parameters[]) =>
      new Promise<sqlite3.RunResult>((resolve, reject) => {
        db.run(
          sql,
          params ?? [],
          function (this: sqlite3.RunResult, err: Error | null) {
            if (err) {
              reject(err);
              return;
            }

            resolve(this);
          },
        );
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
    withTransaction: <T>(fn: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        beginTransaction(db)
          .then(() => fn())
          .then((result) => commitTransaction(db).then(() => resolve(result)))
          .catch((err: Error) =>
            rollbackTransaction(db).then(() => reject(err)),
          );
      }),
  };
};

const beginTransaction = (db: sqlite3.Database) =>
  new Promise<void>((resolve, reject) => {
    db.run('BEGIN TRANSACTION', (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

const commitTransaction = (db: sqlite3.Database) =>
  new Promise<void>((resolve, reject) => {
    db.run('COMMIT', (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

const rollbackTransaction = (db: sqlite3.Database) =>
  new Promise<void>((resolve, reject) => {
    db.run('ROLLBACK', (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
