import { dumbo, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  type AnyRecordedMessageMetadata,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createEventStoreSchema } from '.';
import { appentToStreamRaw } from './appendToStream';
import {
  PostgreSQLEventStoreCheckpoint,
  readMessagesBatch,
} from './readMessagesBatch';

export type TestEvent = Event<'TestEvent', { meta: string }>;

void describe('reading messages in batches', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: PgPool;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      pooled: false,
    });

    await createEventStoreSchema(connectionString, pool);
  });

  beforeEach(async () => {
    await pool.execute.command(
      SQL`TRUNCATE TABLE emt_messages, emt_streams RESTART IDENTITY`,
    );
  });

  afterAll(async () => {
    await pool.close();
    await postgres.stop();
  });

  const createTestEvent = (
    streamName: string,
    meta: string,
    streamPosition: bigint,
  ): RecordedMessage => ({
    type: 'TestEvent',
    kind: 'Event',
    data: { meta },
    metadata: {
      messageId: uuid(),
      streamName,
      streamPosition: streamPosition.toString() as unknown as bigint,
    } satisfies AnyRecordedMessageMetadata,
  });

  void it('reads events in the order transactions began', async () => {
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false });
    const connection2 = await pool.connection({ readonly: false });

    try {
      const tx1 = connection1.transaction();
      await tx1.begin();
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx2 = connection2.transaction();
      await tx2.begin();
      await tx2.execute.query(SQL`SELECT pg_current_xact_id()`);

      // Let's shuffle append order, so 2nd transaction (tx2) writes before the 1st one (tx1), even though tx1 began first. The read batcher must return them in the order of transaction start, not write order.
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt2', 1n),
      ]);
      await tx2.commit();

      await appentToStreamRaw(tx1.execute, streamId1, 'shopping_cart', [
        createTestEvent(streamId1, 'evt1', 1n),
      ]);
      await tx1.commit();

      const poll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(2, poll.messages.length);
      assertEqual('evt1', poll.messages[0]!.data.meta);
      assertEqual('evt2', poll.messages[1]!.data.meta);
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });

  void it('waits for older transactions before exposing newer commits', async () => {
    // "Usain Bolt" scenario: a high-xid transaction commits before a lower-xid one.
    // The xmin filter must prevent its events from being visible until the lower-xid
    // transaction also commits, preserving ordering guarantees.
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false }); // slow, low xid
    const connection2 = await pool.connection({ readonly: false }); // fast, high xid

    try {
      const tx1 = connection1.transaction();
      await tx1.begin();
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx2 = connection2.transaction();
      await tx2.begin();
      await tx2.execute.query(SQL`SELECT pg_current_xact_id()`);

      // tx2 (high xid) writes and commits immediately
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt_fast', 1n),
      ]);
      await tx2.commit();

      // tx1 (low xid) is still open — its xid is the pg_snapshot_xmin,
      // so tx2's committed event must not be visible yet
      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        0,
        firstPoll.messages.length,
        'tx2 event must be invisible while tx1 (lower xid) is still open',
      );

      // tx1 commits — both events become visible
      await appentToStreamRaw(tx1.execute, streamId1, 'shopping_cart', [
        createTestEvent(streamId1, 'evt_slow', 1n),
      ]);
      await tx1.commit();

      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        2,
        secondPoll.messages.length,
        'Both events visible after tx1 commits',
      );
      assertEqual(
        'evt_slow',
        secondPoll.messages[0]!.data.meta,
        'tx1 event first (lower xid)',
      );
      assertEqual(
        'evt_fast',
        secondPoll.messages[1]!.data.meta,
        'tx2 event second (higher xid)',
      );
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });

  void it('does not skip events written by a slow transaction that began before a faster one', async () => {
    // Race condition: tx1 begins first (lower xid) but writes second (higher global_position).
    // tx2 begins second (higher xid) but writes first (lower global_position).
    // tx1 commits first — its event at position 2 becomes visible and the checkpoint advances.
    // tx2 commits later — its event at position 1 is now behind the checkpoint and is missed.
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false }); // tx2 — long running
    const connection2 = await pool.connection({ readonly: false }); // tx1 — quick commit

    try {
      const tx1 = connection2.transaction();
      await tx1.begin();
      // Force XID assignment now so tx1 gets the lower xid, even though tx2 writes first
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx2 = connection1.transaction();
      await tx2.begin();
      // Force XID assignment for tx2 so xids are assigned in begin order, not write order
      await tx2.execute.query(SQL`SELECT pg_current_xact_id()`);

      // tx2 writes first → gets global_position 1, but has the higher xid
      await appentToStreamRaw(tx2.execute, streamId1, 'shopping_cart', [
        createTestEvent(streamId1, 'evt1', 1n),
      ]);

      // tx1 writes second → gets global_position 2, but has the lower xid
      const { global_positions, transaction_id } = await appentToStreamRaw(
        tx1.execute,
        streamId2,
        'shopping_cart',
        [createTestEvent(streamId2, 'evt2', 1n)],
      );

      // tx1 commits — its event at position 2 is now visible (xid < xmin), position 1 is not
      await tx1.commit();

      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        1,
        firstPoll.messages.length,
        'Should only see the committed event (evt2)',
      );
      assertEqual('evt2', firstPoll.messages[0]!.data.meta, 'Should see evt2');
      // Safe checkpoint must not advance past the gap left by the in-flight tx2
      assertDeepEqual(
        {
          transactionId: BigInt(transaction_id!),
          globalPosition: BigInt(global_positions![0]!),
        },
        firstPoll.currentCheckpoint,
      );

      // tx2 commits — evt1 at position 1 is now visible in the DB
      await tx2.commit();

      // Poller reads from the safe checkpoint — evt1 must not be missed
      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: firstPoll.currentCheckpoint,
        batchSize: 10,
      });

      assertEqual(1, secondPoll.messages.length, 'Should see both events');
      assertEqual(
        'evt1',
        secondPoll.messages[0]!.data.meta,
        'evt1 comes first by global_position',
      );
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });

  void it('does not skip multiple events from a slow transaction that began before a faster one', async () => {
    // Same race condition as above, but the slow transaction wrote multiple events.
    // All of them must appear after it commits — not just the first one.
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false }); // tx1 — quick commit, low xid
    const connection2 = await pool.connection({ readonly: false }); // tx2 — slow, high xid

    try {
      const tx1 = connection1.transaction();
      await tx1.begin();
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx2 = connection2.transaction();
      await tx2.begin();
      await tx2.execute.query(SQL`SELECT pg_current_xact_id()`);

      // tx2 writes two events first → positions 1 and 2, but has the higher xid
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt1', 1n),
        createTestEvent(streamId2, 'evt2', 2n),
      ]);

      // tx1 writes one event → position 3, but has the lower xid
      const { global_positions, transaction_id } = await appentToStreamRaw(
        tx1.execute,
        streamId1,
        'shopping_cart',
        [createTestEvent(streamId1, 'evt3', 1n)],
      );

      await tx1.commit();

      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        1,
        firstPoll.messages.length,
        'Only the committed event at position 3 is visible',
      );
      assertEqual('evt3', firstPoll.messages[0]!.data.meta);
      assertDeepEqual(
        {
          transactionId: BigInt(transaction_id!),
          globalPosition: BigInt(global_positions![0]!),
        },
        firstPoll.currentCheckpoint,
        'Checkpoint must not advance past the gap',
      );

      await tx2.commit();

      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: firstPoll.currentCheckpoint,
        batchSize: 10,
      });

      assertEqual(
        2,
        secondPoll.messages.length,
        'All three events must be visible',
      );
      assertEqual('evt1', secondPoll.messages[0]!.data.meta);
      assertEqual('evt2', secondPoll.messages[1]!.data.meta);
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });

  void it('does not skip events from multiple concurrent slow transactions that each began before the fast one', async () => {
    // Two slow transactions both write at lower positions than the fast one.
    // After the fast transaction commits and advances the checkpoint, both slow
    // transactions must still be readable when they eventually commit.
    const streamId1 = uuid();
    const streamId2 = uuid();
    const streamId3 = uuid();

    const connection1 = await pool.connection({ readonly: false }); // tx1 — lowest xid, commits first
    const connection2 = await pool.connection({ readonly: false }); // tx2 — mid xid
    const connection3 = await pool.connection({ readonly: false }); // tx3 — highest xid

    try {
      const tx1 = connection1.transaction();
      await tx1.begin();
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx2 = connection2.transaction();
      await tx2.begin();
      await tx2.execute.query(SQL`SELECT pg_current_xact_id()`);

      const tx3 = connection3.transaction();
      await tx3.begin();
      await tx3.execute.query(SQL`SELECT pg_current_xact_id()`);

      // highest xid writes first → position 1
      await appentToStreamRaw(tx3.execute, streamId3, 'shopping_cart', [
        createTestEvent(streamId3, 'evt1', 1n),
      ]);

      // mid xid writes second → position 2
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt2', 1n),
      ]);

      // lowest xid writes last → position 3, commits first
      const { global_positions, transaction_id } = await appentToStreamRaw(
        tx1.execute,
        streamId1,
        'shopping_cart',
        [createTestEvent(streamId1, 'evt3', 1n)],
      );
      await tx1.commit();

      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(1, firstPoll.messages.length, 'Only tx1 event visible');
      assertEqual('evt3', firstPoll.messages[0]!.data.meta);
      assertDeepEqual(
        {
          transactionId: BigInt(transaction_id!),
          globalPosition: BigInt(global_positions![0]!),
        },
        firstPoll.currentCheckpoint,
        'Checkpoint must not advance past either in-flight gap',
      );

      await tx2.commit();
      await tx3.commit();

      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: firstPoll.currentCheckpoint,
        batchSize: 10,
      });

      assertEqual(
        2,
        secondPoll.messages.length,
        'All events from all three transactions must be visible',
      );
      assertEqual('evt2', secondPoll.messages[0]!.data.meta);
      assertEqual('evt1', secondPoll.messages[1]!.data.meta);
    } finally {
      await connection1.close();
      await connection2.close();
      await connection3.close();
    }
  });

  void it('reads committed events even when earlier positions were rolled back', async () => {
    // A transaction acquires a sequence slot then rolls back, leaving a gap in
    // global_position. The poller must not get confused and must return subsequent
    // committed events correctly.
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false });
    const connection2 = await pool.connection({ readonly: false });

    try {
      const tx1 = connection1.transaction();
      await tx1.begin();

      // tx1 writes to claim a global_position slot, then rolls back — the slot is lost
      await appentToStreamRaw(tx1.execute, streamId1, 'shopping_cart', [
        createTestEvent(streamId1, 'evt_lost', 1n),
      ]);
      await tx1.execute.command(SQL`ROLLBACK`);

      // tx2 writes and commits — gets the next global_position after the gap
      const tx2 = connection2.transaction();
      await tx2.begin();
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt_committed', 1n),
      ]);
      await tx2.commit();

      const poll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        1,
        poll.messages.length,
        'Only the committed event is returned',
      );
      assertEqual('evt_committed', poll.messages[0]!.data.meta);
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });

  void it('reads all messages from one transaction and does not repeat them after the checkpoint advances', async () => {
    // A single transaction appending multiple messages must expose all of them in one
    // batch. Advancing the checkpoint to the last returned position must not re-emit
    // any messages from the same transaction on the next poll.
    const streamId = uuid();

    const connection = await pool.connection({ readonly: false });

    try {
      const tx = connection.transaction();
      await tx.begin();

      await appentToStreamRaw(tx.execute, streamId, 'shopping_cart', [
        createTestEvent(streamId, 'evt1', 1n),
        createTestEvent(streamId, 'evt2', 2n),
      ]);
      await tx.commit();

      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        2,
        firstPoll.messages.length,
        'Both messages from the transaction are returned',
      );
      assertEqual('evt1', firstPoll.messages[0]!.data.meta);
      assertEqual('evt2', firstPoll.messages[1]!.data.meta);

      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: firstPoll.currentCheckpoint,
        batchSize: 10,
      });

      assertEqual(
        0,
        secondPoll.messages.length,
        'No messages re-emitted after checkpoint advances',
      );
    } finally {
      await connection.close();
    }
  });

  void it('blocks visibility of new commits while an older open transaction is pending', async () => {
    // A long-running transaction with a low xid holds pg_snapshot_xmin in place.
    // Any events committed by higher-xid transactions remain invisible until the
    // long-running transaction finally closes, demonstrating the operational risk of
    // holding open transactions for extended periods.
    const streamId1 = uuid();
    const streamId2 = uuid();

    const connection1 = await pool.connection({ readonly: false }); // long-running, low xid
    const connection2 = await pool.connection({ readonly: false }); // short-lived, high xid

    try {
      // Open tx1 and force xid assignment without writing any events
      const tx1 = connection1.transaction();
      await tx1.begin();
      await tx1.execute.query(SQL`SELECT pg_current_xact_id()`);

      // tx2 commits its event — but tx1's xid is still the pg_snapshot_xmin
      const tx2 = connection2.transaction();
      await tx2.begin();
      await appentToStreamRaw(tx2.execute, streamId2, 'shopping_cart', [
        createTestEvent(streamId2, 'evt_blocked', 1n),
      ]);
      await tx2.commit();

      const firstPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        0,
        firstPoll.messages.length,
        'tx2 event is invisible while tx1 (lower xid) is still open',
      );

      // tx1 eventually commits — the visibility window advances and tx2's event appears
      await appentToStreamRaw(tx1.execute, streamId1, 'shopping_cart', [
        createTestEvent(streamId1, 'evt_unblocked', 1n),
      ]);
      await tx1.commit();

      const secondPoll = await readMessagesBatch<TestEvent>(pool.execute, {
        after: PostgreSQLEventStoreCheckpoint.default,
        batchSize: 10,
      });

      assertEqual(
        2,
        secondPoll.messages.length,
        'Both events visible once tx1 commits',
      );
    } finally {
      await connection1.close();
      await connection2.close();
    }
  });
});
