import {
  dumbo,
  sql,
  type Dumbo,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertFalse,
  assertTrue,
  asyncAwaiter,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag, unknownTag } from '../../schema';
import {
  releaseProcessorLock,
  tryAcquireProcessorLock,
} from './tryAcquireProcessorLock';
import {
  toProjectionLockKey,
  tryAcquireProjectionLock,
} from './tryAcquireProjectionLock';

void describe('tryAcquireProcessorLock', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Dumbo;
  const defaultPartitionAndVersion1 = { partition: defaultTag, version: 1 };

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString });
    await createEventStoreSchema(connectionString, pool);
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('multiple async processors (exclusive locks)', () => {
    void it('allows only one processor to acquire lock at a time', async () => {
      const lockKey = 'test_processor_lock_exclusive_1';
      const processorId = 'processor_exclusive_1';
      const processorId2 = 'processor_exclusive_2';

      const firstLockHeld = asyncAwaiter();
      const secondLockAttempted = asyncAwaiter();

      const [firstResult, secondResult] = await Promise.all([
        pool.withTransaction(async (tx) => {
          const result = await tryAcquireProcessorLock(tx.execute, {
            lockKey,
            processorId,
            ...defaultPartitionAndVersion1,
            processorInstanceId: 'instance_1',
          });
          firstLockHeld.resolve();
          await secondLockAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockHeld.wait;
          const result = await pool.withTransaction((tx) =>
            tryAcquireProcessorLock(tx.execute, {
              lockKey,
              processorId: processorId2,
              ...defaultPartitionAndVersion1,
              processorInstanceId: 'instance_2',
            }),
          );
          secondLockAttempted.resolve();
          return result;
        })(),
      ]);

      assertTrue(firstResult.acquired, 'Expected first processor to acquire');
      assertDeepEqual(
        firstResult.checkpoint,
        '0000000000000000000',
        'Expected initial checkpoint to be 0000000000000000000',
      );
      assertFalse(
        secondResult.acquired,
        'Expected second processor to fail while first holds lock',
      );
    });

    void it('allows second processor to acquire after first releases', async () => {
      const lockKey = 'test_processor_lock_release_1';
      const processorId1 = 'processor_release_1';
      const processorId2 = 'processor_release_2';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';

      const firstAcquired = await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId: processorId1,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId1,
        });

        if (result.acquired) {
          await releaseProcessorLock(connection.execute, {
            lockKey,
            processorId: processorId1,
            ...defaultPartitionAndVersion1,
            processorInstanceId: instanceId1,
          });
        }

        return result;
      });

      assertTrue(firstAcquired.acquired, 'Expected first processor to acquire');

      const secondAcquired = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId: processorId2,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
        }),
      );

      assertTrue(
        secondAcquired.acquired,
        'Expected second processor to acquire after first releases',
      );
    });
  });

  void describe('processor ownership checks', () => {
    void it('allows same instance to re-acquire lock', async () => {
      const lockKey = 'test_ownership_reacquire';
      const processorId = 'processor_reacquire';
      const instanceId = 'instance_1';

      await pool.withConnection(async (connection) => {
        const firstResult = await tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId,
        });

        assertTrue(firstResult.acquired, 'Expected first acquire to succeed');

        await releaseProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId,
        });
      });

      const secondResult = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId,
        }),
      );

      assertTrue(secondResult.acquired, 'Expected same instance to re-acquire');
    });

    void it('blocks different instance when processor is running', async () => {
      const lockKey = 'test_ownership_running';
      const processorId = 'processor_running';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';

      const firstLockHeld = asyncAwaiter();
      const secondLockAttempted = asyncAwaiter<{
        acquired: boolean;
        checkpoint?: string;
      }>();

      const [firstResult, secondResult] = await Promise.all([
        pool.withConnection(async (connection) => {
          const result = await tryAcquireProcessorLock(connection.execute, {
            lockKey,
            processorId,
            ...defaultPartitionAndVersion1,
            processorInstanceId: instanceId1,
          });
          firstLockHeld.resolve();
          await secondLockAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockHeld.wait;
          const result = await pool.withConnection((connection) =>
            tryAcquireProcessorLock(connection.execute, {
              lockKey,
              processorId,
              ...defaultPartitionAndVersion1,
              processorInstanceId: instanceId2,
            }),
          );
          secondLockAttempted.resolve(result);
          return result;
        })(),
      ]);

      assertTrue(firstResult.acquired, 'Expected first instance to acquire');
      assertFalse(
        secondResult.acquired,
        'Expected different instance to be blocked when processor is running',
      );
    });

    void it('blocks different instance when processor status is rebuilding', async () => {
      const lockKey = 'test_ownership_rebuilding';
      const processorId = 'processor_rebuilding';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        processorInstanceId: instanceId1,
        status: 'rebuilding',
      });

      const result = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
        }),
      );

      assertFalse(
        result.acquired,
        'Expected different instance to be blocked when processor is rebuilding',
      );
    });

    void it('allows different instance when processor is stopped', async () => {
      const lockKey = 'test_ownership_stopped';
      const processorId = 'processor_stopped';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId1,
        });

        assertTrue(result.acquired, 'Expected first instance to acquire');

        await releaseProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId1,
        });
      });

      const status = await getProcessorStatus(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
      });
      assertDeepEqual(
        status?.status,
        'stopped',
        'Expected processor status to be stopped',
      );

      const secondResult = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
        }),
      );

      assertTrue(
        secondResult.acquired,
        'Expected different instance to acquire when processor is stopped',
      );
    });

    void it('allows takeover when processor_instance_id is unknown', async () => {
      const lockKey = 'test_ownership_takeover';
      const processorId = 'processor_takeover';
      const instanceId = 'instance_1';

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        processorInstanceId: unknownTag,
        status: 'running',
      });

      const result = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId,
        }),
      );

      assertTrue(
        result.acquired,
        'Expected to acquire when processor_instance_id is unknown',
      );
    });
  });

  void describe('projection status management', () => {
    void it('sets projection to rebuilding on acquire', async () => {
      const lockKey = 'test_projection_rebuilding';
      const processorId = 'processor_projection_rebuilding';
      const projectionName = 'projection_rebuilding';

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          projection: {
            name: projectionName,
            type: 'a',
            kind: 'async',
          },
        });

        assertTrue(result.acquired, 'Expected to acquire lock');
      });

      const status = await getProjectionStatus(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        status?.status,
        'rebuilding',
        'Expected projection status to be rebuilding',
      );
    });

    void it('sets projection to active on release', async () => {
      const lockKey = 'test_projection_active';
      const processorId = 'processor_projection_active';
      const projectionName = 'projection_active';
      const instanceId = 'instance_1';

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          projection: {
            name: projectionName,
            type: 'a',
            kind: 'async',
          },
          processorInstanceId: instanceId,
        });

        assertTrue(result.acquired, 'Expected to acquire lock');

        await releaseProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          processorInstanceId: instanceId,
          projectionName,
        });
      });

      const status = await getProjectionStatus(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        status?.status,
        'active',
        'Expected projection status to be active after release',
      );
    });

    void it('creates projection if not exists', async () => {
      const lockKey = 'test_projection_create';
      const processorId = 'processor_projection_create';
      const projectionName = 'new_projection_create';

      const statusBefore = await getProjectionStatus(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        statusBefore,
        null,
        'Expected projection to not exist initially',
      );

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          projection: {
            name: projectionName,
            type: 'a',
            kind: 'async',
          },
        });

        assertTrue(result.acquired, 'Expected to acquire lock');
      });

      const statusAfter = await getProjectionStatus(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        statusAfter?.status,
        'rebuilding',
        'Expected new projection to be created with rebuilding status',
      );
    });

    void it('changes existing active projection to rebuilding on acquire', async () => {
      const lockKey = 'test_projection_change_active';
      const processorId = 'processor_projection_change_active';
      const projectionName = 'active_projection_change';

      await insertProjection(pool.execute, {
        name: projectionName,
        status: 'active',
      });

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          projection: {
            name: projectionName,
            type: 'a',
            kind: 'async',
          },
        });

        assertTrue(result.acquired, 'Expected to acquire lock');
      });

      const status = await getProjectionStatus(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        status?.status,
        'rebuilding',
        'Expected active projection to change to rebuilding',
      );
    });

    void it('does not create projection when lock acquisition fails', async () => {
      const lockKey = 'test_projection_blocked';
      const processorId = 'processor_projection_blocked_1';
      const processorId2 = 'processor_projection_blocked_2';
      const projectionName = 'blocked_projection_1';
      const projectionName2 = 'blocked_projection_2';

      const firstLockHeld = asyncAwaiter();
      const secondLockAttempted = asyncAwaiter();

      await Promise.all([
        pool.withTransaction(async (tx) => {
          const result = await tryAcquireProcessorLock(tx.execute, {
            lockKey,
            processorId,
            ...defaultPartitionAndVersion1,
            projection: {
              name: projectionName,
              type: 'a',
              kind: 'async',
            },
          });
          firstLockHeld.resolve();
          await secondLockAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockHeld.wait;
          const result = await pool.withTransaction(async (tx) =>
            tryAcquireProcessorLock(tx.execute, {
              lockKey,
              processorId: processorId2,
              ...defaultPartitionAndVersion1,
              projection: {
                name: projectionName2,
                type: 'a',
                kind: 'async',
              },
            }),
          );
          secondLockAttempted.resolve();
          return result;
        })(),
      ]);

      const status = await getProjectionStatus(pool.execute, {
        name: projectionName2,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        status,
        null,
        'Expected projection to not be created when lock fails',
      );
    });
  });

  void describe('lock release and crash scenarios', () => {
    void it('explicitly releases advisory lock', async () => {
      const lockKey = 'test_release_explicit';
      const processorId = 'processor_release_explicit_1';
      const processorId2 = 'processor_release_explicit_2';
      const instanceId = 'instance_1';

      await pool.withTransaction(async (tx) => {
        const result = await tryAcquireProcessorLock(tx.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          processorInstanceId: instanceId,
        });

        assertTrue(result.acquired, 'Expected to acquire lock');

        const released = await releaseProcessorLock(tx.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          processorInstanceId: instanceId,
        });

        assertTrue(released, 'Expected release to succeed');
      });

      const secondAcquire = await pool.withTransaction(async (tx) =>
        tryAcquireProcessorLock(tx.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId: processorId2,
        }),
      );

      assertTrue(
        secondAcquire.acquired,
        'Expected lock to be available after release',
      );
    });

    void it('auto-releases lock when connection terminates', async () => {
      const lockKey = 'test_crash_auto_release';
      const processorId = 'processor_crash_auto_release_1';
      const processorId2 = 'processor_crash_auto_release_2';
      const instanceId = 'instance_1';

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          processorInstanceId: instanceId,
        });

        assertTrue(result.acquired, 'Expected to acquire lock');
      });

      const secondAcquire = await pool.withConnection(async (connection) =>
        tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId: processorId2,
        }),
      );

      assertTrue(
        secondAcquire.acquired,
        'Expected lock to be released after connection termination',
      );
    });

    void it('leaves processor status as running after crash', async () => {
      const lockKey = 'test_crash_status';
      const processorId = 'processor_crashed_status';
      const instanceId = 'instance_1';

      await pool.withConnection(async (connection) => {
        const result = await tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
          processorInstanceId: instanceId,
        });

        assertTrue(result.acquired, 'Expected to acquire lock');
      });

      const status = await getProcessorStatus(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
      });

      assertDeepEqual(
        status?.status,
        'running',
        'Expected processor status to remain running after crash',
      );
      assertDeepEqual(
        status?.processor_instance_id,
        instanceId,
        'Expected processor_instance_id to remain set',
      );
    });
  });

  void describe('checkpoint handling', () => {
    void it('returns initial checkpoint as 0 for new processor', async () => {
      const lockKey = 'test_checkpoint_initial';
      const processorId = 'processor_checkpoint_initial';

      const result = await pool.withConnection(async (connection) =>
        tryAcquireProcessorLock(connection.execute, {
          ...defaultPartitionAndVersion1,
          lockKey,
          processorId,
        }),
      );

      assertTrue(result.acquired, 'Expected to acquire lock');
      assertDeepEqual(
        result.checkpoint,
        '0000000000000000000',
        'Expected initial checkpoint to be 0000000000000000000',
      );
    });

    void it('returns existing checkpoint for known processor', async () => {
      const lockKey = 'test_checkpoint_existing';
      const processorId = 'processor_checkpoint_existing';
      const expectedCheckpoint = '12345';

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        lastProcessedCheckpoint: expectedCheckpoint,
      });

      const result = await pool.withConnection(async (connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
        }),
      );

      assertTrue(result.acquired, 'Expected to acquire lock');
      assertDeepEqual(
        result.checkpoint,
        expectedCheckpoint,
        'Expected to return existing checkpoint',
      );
    });
  });

  void describe('shared vs exclusive lock interaction', () => {
    void it('prevents shared projection lock when exclusive processor lock is held', async () => {
      const projectionName = 'test_exclusive_blocks_shared';
      const processorId = 'processor_exclusive_blocks_shared';
      const lockKey = toProjectionLockKey({
        projectionName,
        partition: defaultTag,
        version: 1,
      });

      await insertProjection(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
        status: 'active',
      });

      const exclusiveLockHeld = asyncAwaiter();
      const canReleaseExclusiveLock = asyncAwaiter();

      const [, sharedLockAcquired] = await Promise.all([
        pool.withTransaction(async (tx) => {
          const result = await tryAcquireProcessorLock(tx.execute, {
            lockKey,
            processorId,
            ...defaultPartitionAndVersion1,
          });
          assertTrue(result.acquired, 'Expected processor to acquire lock');
          exclusiveLockHeld.resolve();
          await canReleaseExclusiveLock.wait;
          await releaseProcessorLock(tx.execute, {
            lockKey,
            processorId,
            ...defaultPartitionAndVersion1,
          });
        }),
        (async () => {
          await exclusiveLockHeld.wait;
          const result = await pool.withTransaction(async (transaction) =>
            tryAcquireProjectionLock(transaction.execute, {
              lockKey,
              projectionName,
              ...defaultPartitionAndVersion1,
            }),
          );
          canReleaseExclusiveLock.resolve();
          return result;
        })(),
      ]);

      assertFalse(
        sharedLockAcquired,
        'Expected shared lock to fail when exclusive lock is held',
      );
    });

    void it('returns false when shared projection locks are held', async () => {
      const projectionName = 'test_shared_blocks_exclusive';
      const processorId = 'processor_shared_blocks_exclusive';
      const lockKey = toProjectionLockKey({
        projectionName,
        partition: defaultTag,
        version: 1,
      });

      await insertProjection(pool.execute, {
        name: projectionName,
        ...defaultPartitionAndVersion1,
        status: 'active',
      });

      const sharedLockHeld = asyncAwaiter();
      const canReleaseSharedLock = asyncAwaiter();

      const [sharedLockAcquired, exclusiveLockResult] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await tryAcquireProjectionLock(transaction.execute, {
            lockKey,
            projectionName,
            ...defaultPartitionAndVersion1,
          });
          sharedLockHeld.resolve();
          await canReleaseSharedLock.wait;
          return result;
        }),
        (async () => {
          await sharedLockHeld.wait;
          const result = await pool.withConnection(async (connection) =>
            tryAcquireProcessorLock(connection.execute, {
              lockKey,
              processorId,
              ...defaultPartitionAndVersion1,
            }),
          );
          canReleaseSharedLock.resolve();
          return result;
        })(),
      ]);

      assertTrue(
        sharedLockAcquired,
        'Expected shared lock acquisition to succeed',
      );
      assertFalse(
        exclusiveLockResult.acquired,
        'Expected exclusive lock to fail while shared lock is held',
      );
    });
  });

  void describe('lock timeout scenarios', () => {
    void it('blocks takeover when processor was updated within timeout window', async () => {
      const lockKey = 'test_timeout_blocks_takeover';
      const processorId = 'processor_timeout_blocks';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';
      const lockTimeoutSeconds = 5;

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        processorInstanceId: instanceId1,
        status: 'running',
      });

      const result = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
          lockTimeoutSeconds,
        }),
      );

      assertFalse(
        result.acquired,
        'Expected takeover to fail when processor was recently updated',
      );
    });

    void it('allows takeover when processor last_updated exceeds timeout', async () => {
      const lockKey = 'test_timeout_allows_takeover';
      const processorId = 'processor_timeout_allows';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';
      const lockTimeoutSeconds = 2;

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        processorInstanceId: instanceId1,
        status: 'running',
      });

      await setProcessorLastUpdated(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        secondsAgo: lockTimeoutSeconds + 1,
      });

      const result = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
          lockTimeoutSeconds,
        }),
      );

      assertTrue(
        result.acquired,
        'Expected takeover to succeed when processor last_updated exceeds timeout',
      );
    });

    void it('respects custom timeout for takeover decisions', async () => {
      const lockKey = 'test_custom_timeout';
      const processorId = 'processor_custom_timeout';
      const instanceId1 = 'instance_1';
      const instanceId2 = 'instance_2';
      const customTimeout = 10;

      await insertProcessor(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        processorInstanceId: instanceId1,
        status: 'running',
      });

      await setProcessorLastUpdated(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        secondsAgo: customTimeout - 1,
      });

      const blockedResult = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
          lockTimeoutSeconds: customTimeout,
        }),
      );

      assertFalse(
        blockedResult.acquired,
        'Expected takeover to fail within custom timeout window',
      );

      await setProcessorLastUpdated(pool.execute, {
        processorId,
        ...defaultPartitionAndVersion1,
        secondsAgo: customTimeout + 1,
      });

      const allowedResult = await pool.withConnection((connection) =>
        tryAcquireProcessorLock(connection.execute, {
          lockKey,
          processorId,
          ...defaultPartitionAndVersion1,
          processorInstanceId: instanceId2,
          lockTimeoutSeconds: customTimeout,
        }),
      );

      assertTrue(
        allowedResult.acquired,
        'Expected takeover to succeed after custom timeout expires',
      );
    });
  });
});

const insertProcessor = async (
  execute: SQLExecutor,
  {
    processorId,
    partition,
    version,
    processorInstanceId,
    status,
    lastProcessedCheckpoint,
  }: {
    processorId: string;
    partition?: string;
    version?: number;
    processorInstanceId?: string;
    status?: string;
    lastProcessedCheckpoint?: string;
  },
) => {
  await execute.command(
    sql(
      `INSERT INTO emt_processors (processor_id, partition, version, processor_instance_id, status, last_processed_checkpoint, last_processed_transaction_id)
       VALUES (%L, %L, %s, %L, %L, %L, '0'::xid8)`,
      processorId,
      partition ?? defaultTag,
      version ?? 1,
      processorInstanceId ?? unknownTag,
      status ?? 'stopped',
      lastProcessedCheckpoint ?? '0',
    ),
  );
};

const insertProjection = async (
  execute: SQLExecutor,
  {
    name,
    partition,
    version,
    status,
  }: { name: string; status?: string; partition?: string; version?: number },
) => {
  await execute.command(
    sql(
      `INSERT INTO emt_projections (version, type, name, partition, kind, status, definition)
       VALUES (%s, %L, %L, %L, %L, %L, %L)`,
      version ?? 1,
      'a',
      name,
      partition ?? defaultTag,
      'async',
      status ?? 'active',
      '{}',
    ),
  );
};

const getProcessorStatus = async (
  execute: SQLExecutor,
  {
    processorId,
    partition,
    version,
  }: { processorId: string; partition?: string; version?: number },
): Promise<{
  status: string;
  processor_instance_id: string;
  last_processed_checkpoint: string;
} | null> => {
  const result = await execute.query<{
    status: string;
    processor_instance_id: string;
    last_processed_checkpoint: string;
  }>(
    sql(
      `SELECT status, processor_instance_id, last_processed_checkpoint FROM emt_processors WHERE processor_id = %L AND partition = %L AND version = %s`,
      processorId,
      partition ?? defaultTag,
      version ?? 1,
    ),
  );
  return result.rows[0] ?? null;
};

const getProjectionStatus = async (
  execute: SQLExecutor,
  {
    name,
    partition,
    version,
  }: { name: string; partition?: string; version?: number },
): Promise<{ status: string } | null> => {
  const result = await execute.query<{ status: string }>(
    sql(
      `SELECT status FROM emt_projections WHERE name = %L AND partition = %L AND version = %s`,
      name,
      partition ?? defaultTag,
      version ?? 1,
    ),
  );
  return result.rows[0] ?? null;
};

const setProcessorLastUpdated = async (
  execute: SQLExecutor,
  {
    processorId,
    partition,
    version,
    secondsAgo,
  }: {
    processorId: string;
    partition?: string;
    version?: number;
    secondsAgo: number;
  },
) => {
  await execute.command(
    sql(
      `UPDATE emt_processors
       SET last_updated = now() - interval '%s seconds'
       WHERE processor_id = %L AND partition = %L AND version = %s`,
      secondsAgo.toString(),
      processorId,
      partition ?? defaultTag,
      version ?? 1,
    ),
  );
};
