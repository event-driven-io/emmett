import { dumbo, SQL, type Dumbo } from '@event-driven-io/dumbo';
import { assertTrue } from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag } from '.';

// emt_add_partition sanitizes 'emt:default' into this leaf name.
const defaultActiveLeaf = 'emt_messages_emt_default_active';

// Below roughly this size every plan costs the same and the planner's choice carries
// no information.
const batches = 10;
const perBatch = 2000;
const total = batches * perBatch;

void describe('emt_messages consumer poll indexes', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString });
    await createEventStoreSchema(connectionString, pool);

    // One statement per batch, each its own transaction, so transaction_id ends up
    // correlated with global_position the way a real event store produces it.
    for (let b = 0; b < batches; b++) {
      await pool.execute.command(
        SQL`INSERT INTO emt_messages (
              stream_id, stream_position, transaction_id, partition,
              message_schema_version, message_id, message_type,
              message_data, message_metadata)
            SELECT 'stream-' || g, 1, pg_current_xact_id(), ${defaultTag},
                   '1', 'msg-' || g, 'TestEvent', '{}'::jsonb, '{}'::jsonb
            FROM generate_series(${b * perBatch + 1}::int, ${
              (b + 1) * perBatch
            }::int) g`,
      );
    }
    await pool.execute.command(SQL`ANALYZE emt_messages`);
  });

  after(async () => {
    await pool?.close();
    await postgres?.stop();
  });

  const indexNameOn = async (columns: string): Promise<string | null> => {
    const result = await pool.execute.query<{ index_name: string }>(
      SQL`SELECT ic.relname AS index_name
          FROM pg_index x
          JOIN pg_class ic ON ic.oid = x.indexrelid
          JOIN pg_class tc ON tc.oid = x.indrelid
          WHERE tc.relname = ${defaultActiveLeaf}
            AND pg_get_indexdef(x.indexrelid) LIKE ${'%(' + columns + ')%'}`,
    );
    return result.rows[0]?.index_name ?? null;
  };

  // Mirrors the poll in readMessagesBatch. This version filters on global_position
  // directly, which is what makes the single-column index reachable.
  const explainPoll = async (from: number): Promise<string> => {
    const result = await pool.execute.query<{ 'QUERY PLAN': string }>(
      SQL`EXPLAIN SELECT stream_id, stream_position, global_position
          FROM emt_messages
          WHERE partition = ${defaultTag} AND is_archived = FALSE
            AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
            AND global_position >= ${from}
          ORDER BY transaction_id, global_position
          LIMIT 100`,
    );
    return result.rows.map((row) => row['QUERY PLAN']).join('\n');
  };

  void it('creates both poll indexes on the default active partition', async () => {
    assertTrue((await indexNameOn('global_position')) !== null);
    assertTrue((await indexNameOn('transaction_id, global_position')) !== null);
  });

  void it('does not scan the whole partition at any cursor position', async () => {
    for (const from of [total, total - 100, total / 2, 0]) {
      const plan = await explainPoll(from);
      assertTrue(!new RegExp(`Seq Scan on ${defaultActiveLeaf}\\b`).test(plan));
    }
  });

  // Each index covers a case the other does not, which is why this version ships both.
  // The composite alone leaves the caught-up poll walking from the low end of the
  // index; the single column alone cannot satisfy the ORDER BY, so a deep backlog
  // sorts everything past the cursor.
  void it('uses the single-column index when caught up', async () => {
    const plan = await explainPoll(total);

    assertTrue(plan.includes((await indexNameOn('global_position'))!));
  });

  void it('uses the composite index when replaying from the beginning', async () => {
    const plan = await explainPoll(0);

    assertTrue(
      plan.includes((await indexNameOn('transaction_id, global_position'))!),
    );
  });
});
