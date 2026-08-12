import {
  dumbo,
  sql,
  type Dumbo,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import { assertDeepEqual, assertIsNotNull } from '@event-driven-io/emmett';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag } from '.';
import { readProcessorCheckpoint } from './readProcessorCheckpoint';
import { storeProcessorCheckpoint } from './storeProcessorCheckpoint';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

void describe('storeProcessorCheckpoint and readProcessorCheckpoint tests', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Dumbo;

  const checkpoint1 = 100n;
  const checkpoint2 = 200n;
  const checkpoint3 = 300n;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString });
    await createEventStoreSchema(connectionString, pool);

    await pool.execute.command(
      sql(`SELECT emt_add_partition(%L)`, 'partition-2'),
    );
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should store successfully last proceeded checkpoint for the first time', async () => {
    const processorId = 'processor-first-time';
    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: checkpoint1,
    });
  });

  void it('should store successfully a new checkpoint expecting the previous token', async () => {
    const processorId = 'processor-sequential';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: checkpoint2,
    });
  });

  void it('allows to set older position when lastProcessedCheckpoint matches (e.g. for replays)', async () => {
    const processorId = 'processor-ignored';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint2,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: checkpoint1,
    });
  });

  void it('returns MISMATCH when the lastProcessedPosition is not the one that is currently stored', async () => {
    const processorId = 'processor-mismatch';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint3,
      version: 1,
    });

    assertDeepEqual(result, {
      success: false,
      reason: 'MISMATCH',
    });
  });

  void it('returns CURRENT_AHEAD when current is ahead of target but check position mismatches', async () => {
    const processorId = 'processor-ahead-mismatch-check';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint3,
      version: 1,
    });

    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    assertDeepEqual(result, {
      success: false,
      reason: 'CURRENT_AHEAD',
    });
  });

  void it('can save a checkpoint with a specific partition', async () => {
    const processorId = 'processor-custom-partition';
    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      partition: 'partition-2',
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: checkpoint1,
    });
  });

  void it('can read a position of a processor with the default partition', async () => {
    const processorId = 'processor-read-default';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    const result = await readProcessorCheckpoint(pool.execute, {
      processorId,
    });

    assertDeepEqual(result, { lastProcessedCheckpoint: checkpoint2 });
  });

  void it('can read a composite checkpoint as a 0.42 global position', async () => {
    const processorId = 'processor-read-composite';
    const compositeCheckpoint = `00000000000000000123:${checkpoint2.toString().padStart(19, '0')}`;

    await pool.execute.command(
      sql(
        `INSERT INTO emt_processors (
            processor_id,
            version,
            last_processed_checkpoint,
            partition,
            last_processed_transaction_id,
            created_at,
            last_updated
          )
          VALUES (%L, 1, %L, %L, pg_current_xact_id(), now(), now())`,
        processorId,
        compositeCheckpoint,
        defaultTag,
      ),
    );

    const result = await readProcessorCheckpoint(pool.execute, {
      processorId,
    });

    assertDeepEqual(result, { lastProcessedCheckpoint: checkpoint2 });
  });

  void it('can update when the stored checkpoint is composite and caller uses 0.42 global positions', async () => {
    const processorId = 'processor-update-composite-from-global';
    const compositeCheckpoint = `00000000000000000123:${checkpoint1.toString().padStart(19, '0')}`;

    await pool.execute.command(
      sql(
        `INSERT INTO emt_processors (
            processor_id,
            version,
            last_processed_checkpoint,
            partition,
            last_processed_transaction_id,
            created_at,
            last_updated
          )
          VALUES (%L, 1, %L, %L, pg_current_xact_id(), now(), now())`,
        processorId,
        compositeCheckpoint,
        defaultTag,
      ),
    );

    const result = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: checkpoint2,
    });

    const readResult = await readProcessorCheckpoint(pool.execute, {
      processorId,
    });

    assertDeepEqual(readResult, { lastProcessedCheckpoint: checkpoint2 });
  });

  void it('supports mixed 0.42 and 0.43 checkpoint writes during rolling deployment', async () => {
    const processorId = 'processor-blue-green-checkpoint-sequence';
    const checkpoint4 = 400n;
    const normalizedCheckpoint1 = checkpoint1.toString().padStart(19, '0');
    const normalizedCheckpoint2 = checkpoint2.toString().padStart(19, '0');
    const normalizedCheckpoint3 = checkpoint3.toString().padStart(19, '0');
    const normalizedCheckpoint4 = checkpoint4.toString().padStart(19, '0');
    const compositeCheckpoint2 = `00000000000000000102:${normalizedCheckpoint2}`;
    const compositeCheckpoint4 = `00000000000000000104:${normalizedCheckpoint4}`;

    const initialStore = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    assertDeepEqual(initialStore, {
      success: true,
      newCheckpoint: checkpoint1,
    });

    // Simulate 0.43 node writing composite checkpoint over 0.42 plain checkpoint.
    await pool.execute.command(
      sql(
        `SELECT store_processor_checkpoint(%L, 1, %L, %L, pg_current_xact_id(), %L, %L)`,
        processorId,
        compositeCheckpoint2,
        `00000000000000000101:${normalizedCheckpoint1}`,
        defaultTag,
        processorId,
      ),
    );

    const afterCompositeWrite = await readProcessorCheckpoint(pool.execute, {
      processorId,
    });

    assertDeepEqual(afterCompositeWrite, {
      lastProcessedCheckpoint: checkpoint2,
    });

    // Simulate 0.42 node reading composite as bigint and writing next plain checkpoint.
    const plainWrite = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint2,
      newCheckpoint: checkpoint3,
      version: 1,
    });

    assertDeepEqual(plainWrite, {
      success: true,
      newCheckpoint: checkpoint3,
    });

    // Simulate 0.43 node continuing from the 0.42 plain checkpoint.
    await pool.execute.command(
      sql(
        `SELECT store_processor_checkpoint(%L, 1, %L, %L, pg_current_xact_id(), %L, %L)`,
        processorId,
        compositeCheckpoint4,
        `00000000000000000103:${normalizedCheckpoint3}`,
        defaultTag,
        processorId,
      ),
    );

    const finalRead = await readProcessorCheckpoint(pool.execute, {
      processorId,
    });

    assertDeepEqual(finalRead, {
      lastProcessedCheckpoint: checkpoint4,
    });

    const rawCheckpoint = await pool.execute.query<{
      last_processed_checkpoint: string;
    }>(
      sql(
        `SELECT last_processed_checkpoint
         FROM emt_processors
         WHERE processor_id = %L AND partition = %L AND version = 1`,
        processorId,
        defaultTag,
      ),
    );

    assertDeepEqual(
      rawCheckpoint.rows[0]?.last_processed_checkpoint,
      compositeCheckpoint4,
    );
  });

  void it('can read a position of a processor with a defined partition', async () => {
    const processorId = 'processor-read-custom-partition';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      partition: 'partition-2',
      version: 1,
    });

    const result = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: 'partition-2',
    });

    assertDeepEqual(result, { lastProcessedCheckpoint: checkpoint1 });
  });

  void it('verifies created_at and last_updated are set on insert', async () => {
    const processorId = 'processor-timestamps-insert';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    const timestamps = await getProcessorTimestamps(pool.execute, {
      processorId,
      partition: defaultTag,
    });

    assertIsNotNull(timestamps);
    assertIsNotNull(timestamps.created_at);
    assertIsNotNull(timestamps.last_updated);
  });

  void it('verifies last_updated is updated on checkpoint update', async () => {
    const processorId = 'processor-timestamps-update';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    const timestampsBefore = await getProcessorTimestamps(pool.execute, {
      processorId,
      partition: defaultTag,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    const timestampsAfter = await getProcessorTimestamps(pool.execute, {
      processorId,
      partition: defaultTag,
    });

    assertDeepEqual(
      timestampsBefore !== null &&
        timestampsAfter !== null &&
        timestampsBefore.created_at.getTime() ===
          timestampsAfter.created_at.getTime(),
      true,
      'Expected created_at to remain unchanged',
    );

    assertDeepEqual(
      timestampsBefore !== null &&
        timestampsAfter !== null &&
        timestampsBefore.last_updated.getTime() <
          timestampsAfter.last_updated.getTime(),
      true,
      'Expected last_updated to be updated',
    );
  });

  void it('can store checkpoints for different processor versions independently', async () => {
    const processorId = 'processor-multi-version';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 2,
    });

    const resultV1 = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 1,
    });

    const resultV2 = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 2,
    });

    assertDeepEqual(resultV1, { lastProcessedCheckpoint: checkpoint1 });
    assertDeepEqual(resultV2, { lastProcessedCheckpoint: checkpoint2 });
  });

  void it('different processor versions can progress independently', async () => {
    const processorId = 'processor-independent-progress';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 1,
    });

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint1,
      version: 2,
    });

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint3,
      version: 2,
    });

    const resultV1 = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 1,
    });

    const resultV2 = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 2,
    });

    assertDeepEqual(resultV1, { lastProcessedCheckpoint: checkpoint2 });
    assertDeepEqual(resultV2, { lastProcessedCheckpoint: checkpoint3 });
  });

  void it('optimistic concurrency works independently per version', async () => {
    const processorId = 'processor-version-occ';

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 1,
    });

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: null,
      newCheckpoint: checkpoint2,
      version: 2,
    });

    const resultV1Fail = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint1,
      newCheckpoint: checkpoint3,
      version: 1,
    });

    assertDeepEqual(resultV1Fail, {
      success: false,
      reason: 'MISMATCH',
    });

    const resultV2Success = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      lastProcessedCheckpoint: checkpoint2,
      newCheckpoint: checkpoint3,
      version: 2,
    });

    assertDeepEqual(resultV2Success, {
      success: true,
      newCheckpoint: checkpoint3,
    });

    const resultV1Read = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 1,
    });

    const resultV2Read = await readProcessorCheckpoint(pool.execute, {
      processorId,
      version: 2,
    });

    assertDeepEqual(resultV1Read, { lastProcessedCheckpoint: checkpoint2 });
    assertDeepEqual(resultV2Read, { lastProcessedCheckpoint: checkpoint3 });
  });
});

const getProcessorTimestamps = async (
  execute: SQLExecutor,
  { processorId, partition }: { processorId: string; partition: string },
): Promise<{
  created_at: Date;
  last_updated: Date;
} | null> => {
  const result = await execute.query<{
    created_at: Date;
    last_updated: Date;
  }>(
    sql(
      'SELECT created_at, last_updated FROM emt_processors WHERE processor_id = %L AND partition = %L',
      processorId,
      partition,
    ),
  );
  return result.rows[0] ?? null;
};
