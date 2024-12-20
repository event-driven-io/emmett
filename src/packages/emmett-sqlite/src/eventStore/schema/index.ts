import { type SQLiteConnection } from '../../sqliteConnection';
import {
  eventsTableSQL,
  streamsTableSQL
} from './tables';

export * from './tables';

export const schemaSQL: string[] = [
  streamsTableSQL,
  eventsTableSQL
];

export const createEventStoreSchema = async (
  db: SQLiteConnection
): Promise<void> => {
  for (const sql of schemaSQL) {
    try {
      await db.command(sql)
    } catch (error) {
      console.log(error);
    }
  }
};
