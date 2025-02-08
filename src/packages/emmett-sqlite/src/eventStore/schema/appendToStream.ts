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
  type Parameters,
  type SQLiteConnection,
  type SQLiteError,
} from '../../sqliteConnection';
import { defaultTag, messagesTable, streamsTable } from './typing';

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
    preCommitHook?: (events: Event[]) => void;
  },
): Promise<AppendEventResult> => {
  if (events.length === 0) return { success: false };

  const expectedStreamVersion = toExpectedVersion(
    options?.expectedStreamVersion,
  );

  const eventsToAppend: ReadEvent[] = events.map(
    (e: Event, i: number): ReadEvent => ({
      ...e,
      kind: e.kind ?? 'Event',
      metadata: {
        streamName,
        messageId: uuid(),
        streamPosition: BigInt(i + 1),
        ...('metadata' in e ? (e.metadata ?? {}) : {}),
      },
    }),
  );

  let result: AppendEventResult;

  await db.command(`BEGIN TRANSACTION`);

  try {
    result = await appendEventsRaw(db, streamName, streamType, eventsToAppend, {
      expectedStreamVersion,
    });

    if (options?.preCommitHook) options.preCommitHook(eventsToAppend);
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

    let position: { stream_position: string } | null;

    if (expectedStreamVersion === 0n) {
      position = await db.querySingle<{
        stream_position: string;
      } | null>(
        `INSERT INTO ${streamsTable.name}
            (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES  (
                ?,
                ?,
                ?,
                ?,
                '[]',
                false
            )
            RETURNING stream_position;
          `,
        [
          streamId,
          events.length,
          options?.partition ?? streamsTable.columns.partition,
          streamType,
        ],
      );
    } else {
      position = await db.querySingle<{
        stream_position: string;
      } | null>(
        `UPDATE ${streamsTable.name}
            SET stream_position = stream_position + ?
            WHERE stream_id = ?
            AND partition = ?
            AND is_archived = false
            RETURNING stream_position;
          `,
        [
          events.length,
          streamId,
          options?.partition ?? streamsTable.columns.partition,
        ],
      );
    }

    if (position == null) {
      throw new Error('Could not find stream position');
    }

    streamPosition = BigInt(position.stream_position);

    if (expectedStreamVersion != null) {
      const expectedStreamPositionAfterSave =
        BigInt(expectedStreamVersion) + BigInt(events.length);
      if (streamPosition !== expectedStreamPositionAfterSave) {
        return {
          success: false,
        };
      }
    }

    const { sqlString, values } = buildEventInsertQuery(
      events,
      expectedStreamVersion,
      streamId,
      streamType,
      options?.partition?.toString() ?? defaultTag,
    );

    const returningId = await db.querySingle<{
      global_position: string;
    } | null>(sqlString, values);

    if (returningId?.global_position == null) {
      throw new Error('Could not find global position');
    }

    globalPosition = BigInt(returningId.global_position);
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
): Promise<bigint> {
  const result = await db.querySingle<{ stream_position: string } | null>(
    `SELECT CAST(stream_position AS VARCHAR) AS stream_position FROM ${streamsTable.name} WHERE stream_id = ?`,
    [streamId],
  );

  if (result?.stream_position == null) {
    expectedStreamVersion = 0n;
  } else {
    expectedStreamVersion = BigInt(result.stream_position);
  }
  return expectedStreamVersion;
}

const buildEventInsertQuery = (
  events: ReadEvent[],
  expectedStreamVersion: bigint,
  streamId: string,
  streamType: string,
  partition: string | null | undefined,
): {
  sqlString: string;
  values: Parameters[];
} => {
  const query = events.reduce(
    (
      queryBuilder: { parameterMarkers: string[]; values: Parameters[] },
      event: ReadEvent,
    ) => {
      if (
        event.metadata?.streamPosition == null ||
        typeof event.metadata.streamPosition !== 'bigint'
      ) {
        throw new Error('Stream position is required');
      }

      const streamPosition =
        BigInt(event.metadata.streamPosition) + BigInt(expectedStreamVersion);

      queryBuilder.parameterMarkers.push(`(?,?,?,?,?,?,?,?,?)`);
      queryBuilder.values.push(
        streamId,
        streamPosition.toString() ?? 0,
        partition ?? defaultTag,
        JSONParser.stringify(event.data),
        JSONParser.stringify(event.metadata),
        expectedStreamVersion?.toString() ?? 0,
        event.type,
        event.metadata.messageId,
        false,
      );

      return queryBuilder;
    },
    {
      parameterMarkers: [],
      values: [],
    },
  );

  const sqlString = `
      INSERT INTO ${messagesTable.name} (
          stream_id, 
          stream_position, 
          partition, 
          message_data, 
          message_metadata, 
          message_schema_version, 
          message_type, 
          message_id, 
          is_archived
      ) 
      VALUES ${query.parameterMarkers.join(', ')} 
      RETURNING 
        CAST(global_position as VARCHAR) AS global_position
    `;
  return { sqlString, values: query.values };
};
