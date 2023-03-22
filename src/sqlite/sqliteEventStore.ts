import { EventStore } from '../';
import SQLite from 'better-sqlite3';
import { ConnectionWrapper } from '../shared/lifetime';

export type SQLiteEventStoreOptions = {
  type: 'sqlite';
  fileName: string;
  databaseOptions?: SQLite.Options;
};

type SQLiteConnection = ConnectionWrapper<SQLite.Database>;

const getSQLiteConnection = ({
  fileName,
  databaseOptions,
}: SQLiteEventStoreOptions): SQLiteConnection => {
  const db = new SQLite(fileName, databaseOptions);
  db.pragma('journal_mode = WAL');

  return ConnectionWrapper(db, () => {
    db.close();
    return Promise.resolve();
  });
};

const ping = async (db: SQLite.Database) => {
  const result = db.prepare("SELECT 'pong' as pong").pluck().get() as 'pong';

  return Promise.resolve(result);
};

export const getSQLiteEventStore = (
  options: SQLiteEventStoreOptions
): EventStore => {
  const connection = getSQLiteConnection(options);

  return {
    type: 'sqlite',
    close: connection.close,
    init: async () => {
      connection.db().prepare("SELECT date('now')").run();

      return Promise.resolve();
    },
    diagnostics: {
      ping: async () => ping(connection.db()),
    },
  };
};
