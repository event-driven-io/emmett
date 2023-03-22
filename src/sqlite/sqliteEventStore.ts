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
  return {
    init: () => {
      const db = new Database(fileName, databaseOptions);
      db.pragma('journal_mode = WAL');

      db.prepare("SELECT date('now')").run();

      return Promise.resolve();
    },
  };
};
