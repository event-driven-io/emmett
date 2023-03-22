import { EventStore } from 'src/eventStore';
import Database from 'better-sqlite3';

export type SQLiteEventStoreOptions = {
  type: 'sqlite';
  fileName: string;
  databaseOptions?: Database.Options;
};

export const getSQLiteEventStore = ({
  fileName,
  databaseOptions,
}: SQLiteEventStoreOptions): EventStore => {
  const db = new Database(fileName, databaseOptions);
  db.pragma('journal_mode = WAL');

  const ping = () => {
    const result = db.prepare("SELECT 'pong' as pong").pluck().get() as 'pong';

    return Promise.resolve(result);
  };

  return {
    type: 'sqlite',
    init: () => {
      db.pragma('journal_mode = WAL');

      db.prepare("SELECT date('now')").run();

      return Promise.resolve();
    },
    diagnostics: {
      ping,
    },
  };
};
