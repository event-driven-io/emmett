import { type SQLiteConnection } from '../../sqliteConnection';
import { messagesTableSQL, streamsTableSQL } from './tables';

export * from './tables';

export const schemaSQL: string[] = [streamsTableSQL, messagesTableSQL];

export const createEventStoreSchema = async (
  db: SQLiteConnection,
): Promise<void> => {
  for (const sql of schemaSQL) {
    await db.command(sql);
  }
};
