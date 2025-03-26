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

  if (fileName.startsWith('file:')) {
    db = new sqlite3.Database(
      fileName,
      sqlite3.OPEN_URI | sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    );
  } else {
    db = new sqlite3.Database(fileName);
  }
  db.run('PRAGMA journal_mode = WAL;');
  let transactionNesting = 0;

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
    withTransaction: async <T>(fn: () => Promise<T>) => {
      try {
        if (transactionNesting++ == 0) {
          await beginTransaction(db);
        }
        const result = await fn();

        if (transactionNesting === 1) await commitTransaction(db);
        transactionNesting--;

        return result;
      } catch (err) {
        console.log(err);

        if (--transactionNesting === 0) await rollbackTransaction(db);

        throw err;
      }
    },
  };
};

const beginTransaction = (db: sqlite3.Database) =>
  new Promise<void>((resolve, reject) => {
    db.run('BEGIN IMMEDIATE TRANSACTION', (err: Error | null) => {
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
