import { type SQLiteConnection } from '../../sqliteConnection';
import { eventsTableSQL, eventStreamTrigger, streamsTableSQL } from './tables';

export * from './tables';

export const schemaSQL: string[] = [
  streamsTableSQL,
  eventsTableSQL,
  eventStreamTrigger,
];

export const createEventStoreSchema = async (
  db: SQLiteConnection,
): Promise<void> => {
  for (const sql of schemaSQL) {
    try {
      await db.command(sql);
    } catch (err: unknown) {
      throw err;
    }
  }
};
