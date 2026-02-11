import { dumbo, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertIsNotNull,
  bigIntProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag } from '.';
import { readProcessorCheckpoint } from './readProcessorCheckpoint';
import { storeProcessorCheckpoint } from './storeProcessorCheckpoint';

void describe('storeProcessorCheckpoint and readProcessorCheckpoint tests', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: PgPool;

  const checkpoint1 = bigIntProcessorCheckpoint(100n);
  const checkpoint2 = bigIntProcessorCheckpoint(200n);
  const checkpoint3 = bigIntProcessorCheckpoint(300n);

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString, driver: pgDumboDriver });
    await createEventStoreSchema(connectionString, pool);

    await pool.execute.command(SQL`SELECT emt_add_partition('partition-2')`);
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
    SQL`SELECT created_at, last_updated FROM emt_processors WHERE processor_id = ${processorId} AND partition = ${partition}`,
  );
  return result.rows[0] ?? null;
};
