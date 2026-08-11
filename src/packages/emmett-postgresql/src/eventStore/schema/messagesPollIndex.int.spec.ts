import { dumbo, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { createEventStoreSchema } from '.';
import {
  readMessagesBatchSQL,
  type PostgreSQLEventStoreCheckpoint,
} from './readMessagesBatch';
import { defaultTag } from './typing';

// emt_add_partition sanitizes 'emt:default' into this leaf name.
const defaultActiveLeaf = 'emt_messages_emt_default_active';
const pollIndexName = 'idx_messages_transaction_id_global_position';
const tenantPartition = 'tenant_a';
const tenantActiveLeaf = 'emt_messages_tenant_a_active';

// Below roughly this size the planner picks a bitmap scan plus a Sort, so the
// no-Sort assertions would fail on a table too small to represent a real event store.
const seededTransactions = 10;
const messagesPerTransaction = 2000;
const seededMessages = seededTransactions * messagesPerTransaction;

void describe('emt_messages consumer poll index', () => {
  // Needs its own database, not its own container: ANALYZE is not transactional for
  // reltuples/relpages, so this seed's statistics would otherwise outlive the spec.
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    const connectionString = database.connectionString;
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      transactionOptions: { allowNestedTransactions: true },
      pooled: false,
    });

    await createEventStoreSchema(connectionString, pool);
    await seedMessages(defaultTag, 0);
    await pool.execute.command(SQL`ANALYZE emt_messages`);
  });

  afterAll(async () => {
    await pool?.close();
    await database?.close();
  });

  // One statement per batch, each its own transaction, so transaction_id ends up
  // correlated with global_position the way a real event store produces it.
  const seedMessages = async (partition: string, streamOffset: number) => {
    for (let batch = 0; batch < seededTransactions; batch++) {
      const from = streamOffset + batch * messagesPerTransaction + 1;
      const to = streamOffset + (batch + 1) * messagesPerTransaction;

      await pool.execute.command(
        SQL`INSERT INTO emt_messages (
              stream_id, stream_position, transaction_id, partition,
              message_schema_version, message_id, message_type,
              message_data, message_metadata)
            SELECT 'stream-' || g, 1, pg_current_xact_id(), ${partition},
                   '1', 'msg-' || g, 'TestEvent',
                   '{}'::jsonb, '{}'::jsonb
            FROM generate_series(${from}::int, ${to}::int) g`,
      );
    }
  };

  // Walks the index inheritance tree. Child index names are generated and truncated,
  // so they have to be looked up rather than assumed.
  const pollIndexTree = async (): Promise<
    { indexName: string; tableName: string; valid: boolean }[]
  > => {
    const result = await pool.execute.query<{
      index_name: string;
      table_name: string;
      valid: boolean;
    }>(SQL`
      WITH RECURSIVE tree AS (
        SELECT oid FROM pg_class WHERE relname = ${pollIndexName}
        UNION ALL
        SELECT inh.inhrelid FROM pg_inherits inh JOIN tree ON inh.inhparent = tree.oid
      )
      SELECT ic.relname AS index_name, tc.relname AS table_name, x.indisvalid AS valid
      FROM tree
      JOIN pg_class ic ON ic.oid = tree.oid
      JOIN pg_index x ON x.indexrelid = ic.oid
      JOIN pg_class tc ON tc.oid = x.indrelid`);

    return result.rows.map((row) => ({
      indexName: row.index_name,
      tableName: row.table_name,
      valid: row.valid,
    }));
  };

  const indexNameFor = async (tableName: string): Promise<string> => {
    const match = (await pollIndexTree()).find(
      (entry) => entry.tableName === tableName,
    );
    expect(
      match,
      `expected an index on ${tableName} descending from ${pollIndexName}`,
    ).toBeDefined();
    return match!.indexName;
  };

  /** EXPLAINs the real poll query, not a copy of it. */
  const explainPoll = async (
    after: PostgreSQLEventStoreCheckpoint,
    partition?: string,
  ): Promise<string> => {
    const result = await pool.execute.query<{ 'QUERY PLAN': string }>(
      SQL`EXPLAIN ${readMessagesBatchSQL({
        after,
        batchSize: 100,
        partition,
      })}`,
    );
    return result.rows.map((row) => row['QUERY PLAN']).join('\n');
  };

  /** Cursor of the nth committed message, 1-based; 0 means replay from scratch. */
  const checkpointAt = async (
    position: number,
  ): Promise<PostgreSQLEventStoreCheckpoint> => {
    if (position <= 0) return { transactionId: 0n, globalPosition: 0n };

    const result = await pool.execute.query<{
      transaction_id: string;
      global_position: string;
    }>(SQL`SELECT transaction_id, global_position
           FROM emt_messages
           WHERE is_archived = FALSE
           ORDER BY transaction_id, global_position
           OFFSET ${position - 1} LIMIT 1`);

    const row = result.rows[0]!;
    return {
      transactionId: BigInt(row.transaction_id),
      globalPosition: BigInt(row.global_position),
    };
  };

  void it('creates the poll index on the default active partition', async () => {
    const tree = await pollIndexTree();

    expect(tree.map((entry) => entry.tableName)).toContain(defaultActiveLeaf);
    expect(tree.every((entry) => entry.valid)).toBe(true);
  });

  const regimes: { name: string; position: () => number }[] = [
    { name: 'caught up', position: () => seededMessages },
    { name: 'slightly behind', position: () => seededMessages - 100 },
    { name: 'deep in backlog', position: () => Math.floor(seededMessages / 2) },
    { name: 'replaying from zero', position: () => 0 },
  ];

  for (const regime of regimes) {
    void it(`uses the poll index when ${regime.name}`, async () => {
      const leafIndex = await indexNameFor(defaultActiveLeaf);

      const plan = await explainPoll(await checkpointAt(regime.position()));

      // Negative scoped to this relation: an unscoped 'no Seq Scan' also trips on
      // unrelated sibling scans and never says which relation regressed.
      expect(plan).toMatch(new RegExp(`Index Scan using ${leafIndex}\\b`));
      expect(plan).not.toMatch(
        new RegExp(`Seq Scan on ${defaultActiveLeaf}\\b`),
      );
      // A plan that still sorts has not fixed the problem, even when it does read
      // through this index.
      expect(plan).not.toMatch(/Sort/);
    });
  }

  void it('is inherited by partitions created after the schema exists', async () => {
    await pool.execute.command(
      SQL`SELECT emt_add_partition(${tenantPartition})`,
    );

    const tree = await pollIndexTree();
    const covered = tree.map((entry) => entry.tableName);

    expect(covered).toContain(tenantActiveLeaf);
    expect(covered).toContain('emt_messages_tenant_a_archived');
    expect(tree.every((entry) => entry.valid)).toBe(true);
  });

  void it('uses the inherited index when polling a non-default partition', async () => {
    await pool.execute.command(
      SQL`SELECT emt_add_partition(${tenantPartition})`,
    );
    await seedMessages(tenantPartition, 100_000);
    await pool.execute.command(SQL`ANALYZE emt_messages`);

    const tenantIndex = await indexNameFor(tenantActiveLeaf);
    const plan = await explainPoll(
      await checkpointAt(seededMessages + messagesPerTransaction),
      tenantPartition,
    );

    expect(plan).toMatch(new RegExp(`Index Scan using ${tenantIndex}\\b`));
    expect(plan).not.toMatch(new RegExp(`Seq Scan on ${tenantActiveLeaf}\\b`));
    expect(plan).not.toMatch(/Sort/);
  });

  // Mirrors readLastCommittedMessageCheckpoint, which has no cursor to bound it and
  // so sorts the whole partition on every call without this index.
  void it('serves the last-committed-checkpoint read backwards', async () => {
    const leafIndex = await indexNameFor(defaultActiveLeaf);

    const result = await pool.execute.query<{ 'QUERY PLAN': string }>(
      SQL`EXPLAIN SELECT transaction_id, global_position
          FROM emt_messages
          WHERE partition = ${defaultTag} AND is_archived = FALSE
          ORDER BY transaction_id DESC, global_position DESC
          LIMIT 1`,
    );
    const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');

    expect(plan).toMatch(
      new RegExp(`Index Scan Backward using ${leafIndex}\\b`),
    );
    expect(plan).not.toMatch(/Sort/);
  });
});
