import {
  JSONParser,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AppendToStreamOptions,
  type Event,
  type ExpectedStreamVersion,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import {
  isSQLiteError,
  SQLiteError,
  type Parameters,
  type SQLiteConnection,
} from '../../sqliteConnection';
import { defaultTag, eventsTable, streamsTable } from './typing';

export type AppendEventResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      lastGlobalPosition: bigint;
    }
  | { success: false };

export const appendToStream = async (
  db: SQLiteConnection,
  streamName: string,
  streamType: string,
  events: Event[],
  options?: AppendToStreamOptions & {
    partition?: string;
  },
): Promise<AppendEventResult> => {
  if (events.length === 0) return { success: false };

  const expectedStreamVersion = toExpectedVersion(
    options?.expectedStreamVersion,
  );

  const eventsToAppend: ReadEvent[] = events.map(
    (e: Event, i: number): ReadEvent => ({
      ...e,
      metadata: {
        streamName,
        eventId: uuid(),
        streamPosition: BigInt(i + 1),
        ...e.metadata,
      },
    }),
  );

  let result: AppendEventResult;

  await db.command(`BEGIN TRANSACTION`);

  try {
    result = await appendEventsRaw(db, streamName, streamType, eventsToAppend, {
      expectedStreamVersion,
    });
  } catch (err: unknown) {
    await db.command(`ROLLBACK`);
    throw err;
  }

  if (result.success == null || !result.success) {
    await db.command(`ROLLBACK`);
    return result;
  }

  await db.command(`COMMIT`);

  return result;
};

const toExpectedVersion = (
  expected: ExpectedStreamVersion | undefined,
): bigint | null => {
  if (expected === undefined) return null;

  if (expected === NO_CONCURRENCY_CHECK) return null;

  // TODO: this needs to be fixed
  if (expected == STREAM_DOES_NOT_EXIST) return null;

  // TODO: this needs to be fixed
  if (expected == STREAM_EXISTS) return null;

  return expected as bigint;
};

const appendEventsRaw = async (
  db: SQLiteConnection,
  streamId: string,
  streamType: string,
  events: ReadEvent[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
  },
): Promise<AppendEventResult> => {
  let streamPosition;
  let globalPosition;
  try {
    let expectedStreamVersion = options?.expectedStreamVersion ?? null;

    if (expectedStreamVersion == null) {
      expectedStreamVersion = await getLastStreamPosition(
        db,
        streamId,
        expectedStreamVersion,
      );
    }

    const buildQuery = `INSERT INTO ${eventsTable.name} (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, is_archived) VALUES `;

    const query = events.reduce(
      (
        queryBuilder: {
          sql: string[];
          values: Parameters[];
        },
        e: ReadEvent,
      ) => {
        const streamPosition =
          e.metadata.streamPosition + expectedStreamVersion;

        queryBuilder.sql.push(`(?,?,?,?,?,?,?,?,?)`);
        queryBuilder.values.push(
          streamId,
          streamPosition.toString(),
          options?.partition?.toString() ?? defaultTag,
          JSONParser.stringify(e.data),
          JSONParser.stringify({ streamType: streamType, ...e.metadata }),
          expectedStreamVersion?.toString() ?? 0,
          e.type,
          e.metadata.eventId,
          false,
        );

        return queryBuilder;
      },
      {
        sql: [],
        values: [],
      },
    );

    const sqlString = buildQuery + query.sql.join(', ');

    await db.command(sqlString, query.values);

    const positions = await db.querySingle<{
      stream_position: string;
      global_position: string;
    } | null>(
      `
        SELECT 
        CAST(stream_position AS VARCHAR) AS stream_position, 
        CAST(global_position AS VARCHAR) AS global_position  
        FROM ${eventsTable.name} 
        WHERE stream_id = ? 
        ORDER BY stream_position DESC 
        LIMIT 1`,
      [streamId],
    );

    if (positions == null) {
      throw new Error('Could not find stream positions');
    }

    streamPosition = BigInt(positions.stream_position);
    globalPosition = BigInt(positions.global_position);
  } catch (err: unknown) {
    if (isSQLiteError(err) && isOptimisticConcurrencyError(err)) {
      return {
        success: false,
      };
    }

    throw err;
  }

  return {
    success: true,
    nextStreamPosition: streamPosition,
    lastGlobalPosition: globalPosition,
  };
};

const isOptimisticConcurrencyError = (error: SQLiteError): boolean => {
  return error?.errno !== undefined && error.errno === 19;
};

async function getLastStreamPosition(
  db: SQLiteConnection,
  streamId: string,
  expectedStreamVersion: bigint | null,
) {
  const result = await db.querySingle<{ stream_position: string } | null>(
    `SELECT CAST(MAX(stream_position) AS VARCHAR) AS stream_position FROM ${streamsTable.name} WHERE stream_id = ?`,
    [streamId],
  );

  if (result?.stream_position == null) {
    expectedStreamVersion = 0n;
  } else {
    expectedStreamVersion = BigInt(result.stream_position);
  }
  return expectedStreamVersion;
}
