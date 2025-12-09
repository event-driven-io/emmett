import {
  InMemorySharedCacheSQLiteDatabase,
  InMemorySQLiteDatabase,
  sqliteConnection,
  type SQLiteConnection,
} from './sqliteConnection';

export type SQLiteConnectionPool = {
  connection: () => Promise<SQLiteConnection>;

  withConnection: <Result = unknown>(
    handle: (connection: SQLiteConnection) => Promise<Result>,
  ) => Promise<Result>;

  close: () => Promise<void>;
};

export type SQLiteConnectionPoolOptions = {
  fileName: // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    | InMemorySQLiteDatabase
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    | InMemorySharedCacheSQLiteDatabase
    | string
    | undefined;

  connectionOptions?:
    | {
        singleton: true;
        connection?: SQLiteConnection;
      }
    | {
        singleton?: false;
        connection?: never;
      };
};

export const SQLiteConnectionPool = (
  options: SQLiteConnectionPoolOptions,
): SQLiteConnectionPool => {
  const fileName = options.fileName ?? InMemorySQLiteDatabase;

  const isInMemory: boolean =
    fileName === InMemorySQLiteDatabase ||
    fileName === InMemorySharedCacheSQLiteDatabase;

  const singletonConnection: SQLiteConnection | null =
    options.connectionOptions?.connection ??
    (isInMemory
      ? sqliteConnection({
          fileName,
        })
      : null);

  const isAmbientConnection =
    options.connectionOptions?.singleton === true &&
    options.connectionOptions?.connection !== undefined;

  const createConnection = () => {
    return (
      singletonConnection ??
      sqliteConnection({
        fileName,
      })
    );
  };

  const closeConnection = (connection: SQLiteConnection) => {
    if (isInMemory || isAmbientConnection) {
      return;
    }
    connection.close();
  };

  const withConnection = async <Result>(
    handler: (connection: SQLiteConnection) => Promise<Result>,
  ): Promise<Result> => {
    const connection = singletonConnection ?? createConnection();

    try {
      return await handler(connection);
    } finally {
      closeConnection(connection);
    }
  };

  return {
    connection: () => Promise.resolve(createConnection()),
    withConnection,
    close: () => {
      if (singletonConnection && !isAmbientConnection) {
        closeConnection(singletonConnection);
      }

      return Promise.resolve();
    },
  };
};
