import {
  single,
  singleOrNull,
  SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type { Event } from '@event-driven-io/emmett';
import { defaultTag } from '../../typing';

type V0387ReadEvent<E extends Event> = {
  type: E['type'];
  data: E['data'];
  metadata: {
    messageId: string;
    streamName: string;
    streamPosition: bigint;
    globalPosition: bigint;
    transactionId: bigint;
  };
};

export const appendToStream = async <E extends Event>(
  execute: SQLExecutor,
  options: {
    streamId: string;
    streamType: string;
    events: E[];
    expectedStreamPosition?: bigint | null;
    partition?: string;
  },
): Promise<{
  success: boolean;
  nextStreamPosition: bigint;
  globalPositions: bigint[];
  transactionId: bigint;
}> => {
  const messageIds = options.events.map(() => crypto.randomUUID());

  const row = await single(
    execute.command<{
      success: boolean;
      next_stream_position: string;
      global_positions: string[];
      transaction_id: string;
    }>(
      SQL`SELECT * FROM emt_append_to_stream(
        ${messageIds},
        ${options.events.map((e) => e.data)},
        ${options.events.map(() => ({}))},
        ${options.events.map(() => '1')},
        ${options.events.map((e) => e.type)},
        ${options.events.map(() => 'E')},
        ${options.streamId}::text,
        ${options.streamType}::text,
        ${options.expectedStreamPosition ?? null},
        ${options.partition ?? defaultTag}::text
      )`,
    ),
  );

  return {
    success: row.success,
    nextStreamPosition: BigInt(row.next_stream_position),
    globalPositions: row.global_positions.map(BigInt),
    transactionId: BigInt(row.transaction_id),
  };
};

export const readEvents = async <E extends Event>(
  execute: SQLExecutor,
  options: { streamId: string; partition?: string },
): Promise<{
  events: V0387ReadEvent<E>[];
  currentStreamVersion: bigint;
  streamExists: boolean;
}> => {
  const result = await execute.query<{
    message_type: string;
    message_data: E['data'];
    stream_position: string;
    global_position: string;
    transaction_id: string;
    message_id: string;
  }>(
    SQL`SELECT message_type, message_data, stream_position, global_position, transaction_id, message_id
         FROM emt_messages
         WHERE stream_id = ${options.streamId} AND partition = ${options.partition ?? defaultTag} AND is_archived = FALSE
         ORDER BY stream_position ASC`,
  );

  if (result.rows.length === 0) {
    return { events: [], currentStreamVersion: 0n, streamExists: false };
  }

  const events = result.rows.map((row): V0387ReadEvent<E> => ({
    type: row.message_type,
    data: row.message_data,
    metadata: {
      messageId: row.message_id,
      streamName: options.streamId,
      streamPosition: BigInt(row.stream_position),
      globalPosition: BigInt(row.global_position),
      transactionId: BigInt(row.transaction_id),
    },
  }));

  return {
    events,
    currentStreamVersion: BigInt(
      result.rows[result.rows.length - 1]!.stream_position,
    ),
    streamExists: true,
  };
};

export const storeSubscriptionCheckpoint = async (
  execute: SQLExecutor,
  options: {
    subscriptionId: string;
    version?: number;
    position: bigint | null;
    checkPosition: bigint | null;
    partition?: string;
  },
): Promise<{ result: 0 | 1 | 2 }> => {
  const row = await single(
    execute.command<{ result: 0 | 1 | 2 }>(
      SQL`SELECT store_subscription_checkpoint(
        ${options.subscriptionId},
        ${options.version ?? 1},
        ${options.position},
        ${options.checkPosition},
        pg_current_xact_id(),
        ${options.partition ?? defaultTag}
      ) as result`,
    ),
  );
  return { result: row.result };
};

export const insertSubscriptionCheckpoint = (
  execute: SQLExecutor,
  options: {
    subscriptionId: string;
    version?: number;
    position: bigint | null;
    partition?: string;
  },
) =>
  execute.command(
    SQL`INSERT INTO emt_subscriptions (subscription_id, version, partition, last_processed_position, last_processed_transaction_id)
        VALUES (
          ${options.subscriptionId},
          ${options.version ?? 1},
          ${options.partition ?? defaultTag},
          ${options.position},
          pg_current_xact_id()
        )`,
  );

export const readSubscriptionCheckpoint = async (
  execute: SQLExecutor,
  options: {
    subscriptionId: string;
    version?: number;
    partition?: string;
  },
): Promise<{ position: bigint | null; transactionId: string | null }> => {
  const row = await singleOrNull(
    execute.query<{
      last_processed_position: string | null;
      last_processed_transaction_id: string | null;
    }>(
      SQL`SELECT last_processed_position, last_processed_transaction_id
           FROM emt_subscriptions
           WHERE subscription_id = ${options.subscriptionId}
             AND version = ${options.version ?? 1}
             AND partition = ${options.partition ?? defaultTag}
           LIMIT 1`,
    ),
  );

  if (row === null) return { position: null, transactionId: null };

  return {
    position:
      row.last_processed_position !== null
        ? BigInt(row.last_processed_position)
        : null,
    transactionId: row.last_processed_transaction_id ?? null,
  };
};
