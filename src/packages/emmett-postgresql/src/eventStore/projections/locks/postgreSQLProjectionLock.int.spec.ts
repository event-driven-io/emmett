import {
  dumbo,
  sql,
  type Dumbo,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  asyncAwaiter,
  hashText,
} from '@event-driven-io/emmett';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag } from '../../schema';
import {
  postgreSQLProjectionLock,
  toProjectionLockKey,
} from './postgreSQLProjectionLock';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

void describe('tryAcquireProjectionLock', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Dumbo;
  const defaultPartitionAndVersion1 = { partition: defaultTag, version: 1 };

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
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

  void describe('concurrent shared locks', () => {
    void it('allows multiple shared locks simultaneously', async () => {
      // Given
      await insertProjection(pool.execute, {
        ...defaultPartitionAndVersion1,
        name: 'test_concurrent',
        status: 'active',
      });

      const firstLockHeld = asyncAwaiter();
      const secondLockAcquired = asyncAwaiter<boolean>();

      const lockA = postgreSQLProjectionLock({
        ...defaultPartitionAndVersion1,
        projectionName: 'test_concurrent',
      });
      const lockB = postgreSQLProjectionLock({
        ...defaultPartitionAndVersion1,
        projectionName: 'test_concurrent',
      });

      // When
      const results = await Promise.all([
        // Transaction A: acquire shared lock, hold while B acquires, then release
        pool.withTransaction(async (transaction) => {
          const result = await lockA.tryAcquire({
            execute: transaction.execute,
          });
          firstLockHeld.resolve();
          await secondLockAcquired.wait;
          return result;
        }),
        // Transaction B: wait for A to hold lock, then acquire shared lock too
        (async () => {
          await firstLockHeld.wait;
          const result = await pool.withTransaction(async (transaction) => {
            const lockResult = await lockB.tryAcquire({
              execute: transaction.execute,
            });
            secondLockAcquired.resolve(lockResult);
            return lockResult;
          });
          return result;
        })(),
      ]);

      // Then
      assertTrue(
        results[0],
        'Expected first concurrent shared lock to succeed',
      );
      assertTrue(
        results[1],
        'Expected second concurrent shared lock to succeed',
      );
    });

    void it('prevents exclusive lock when shared locks are held', async () => {
      // Given
      await insertProjection(pool.execute, {
        ...defaultPartitionAndVersion1,
        name: 'test_shared_blocks_exclusive',
        status: 'active',
      });

      const lockKey = toProjectionLockKey({
        projectionName: 'test_shared_blocks_exclusive',
        partition: defaultTag,
        version: 1,
      });

      const lock = postgreSQLProjectionLock({
        ...defaultPartitionAndVersion1,
        projectionName: 'test_shared_blocks_exclusive',
      });

      const sharedLockHeld = asyncAwaiter();
      const canReleaseSharedLock = asyncAwaiter();

      // When
      const [sharedLockAcquired, exclusiveLockAcquired] = await Promise.all([
        // Transaction A: acquire shared lock, hold it, then release
        pool.withTransaction(async (transaction) => {
          const result = await lock.tryAcquire({
            execute: transaction.execute,
          });
          sharedLockHeld.resolve();
          await canReleaseSharedLock.wait;
          return result;
        }),
        // Transaction B: wait for shared lock to be held, then try exclusive
        (async () => {
          await sharedLockHeld.wait;
          const result = await tryAcquireExclusiveLock(pool.execute, lockKey);
          canReleaseSharedLock.resolve();
          return result;
        })(),
      ]);

      // Then
      assertTrue(
        sharedLockAcquired,
        'Expected shared lock acquisition to succeed',
      );
      assertFalse(
        exclusiveLockAcquired,
        'Expected exclusive lock to fail while shared lock is held',
      );
    });
  });

  void describe('exclusive lock blocking', () => {
    void it('returns false when exclusive lock is held by another connection', async () => {
      // Given
      await pool.withTransaction(async (transaction) => {
        await insertProjection(transaction.execute, {
          name: 'test_exclusive',
          partition: defaultTag,
          version: 1,
          status: 'active',
        });
      });

      const lockKey = toProjectionLockKey({
        projectionName: 'test_exclusive',
        partition: defaultTag,
        version: 1,
      });

      const lock = postgreSQLProjectionLock({
        projectionName: 'test_exclusive',
        partition: defaultTag,
        version: 1,
      });

      const exclusiveLockHeld = asyncAwaiter();
      const canReleaseExclusiveLock = asyncAwaiter();

      // When
      const [, sharedLockAcquired] = await Promise.all([
        // Connection A: acquire exclusive lock, hold it, then release
        pool.withTransaction(async (connection) => {
          await acquireExclusiveLock(connection.execute, lockKey);
          exclusiveLockHeld.resolve();
          await canReleaseExclusiveLock.wait;
          await releaseExclusiveLock(connection.execute, lockKey);
        }),
        // Transaction B: wait for exclusive lock, then try shared lock
        (async () => {
          await exclusiveLockHeld.wait;
          const result = await pool.withTransaction(async (transaction) =>
            lock.tryAcquire({ execute: transaction.execute }),
          );
          canReleaseExclusiveLock.resolve();
          return result;
        })(),
      ]);

      // Then
      assertFalse(
        sharedLockAcquired,
        'Expected shared lock to fail when exclusive lock is held',
      );
    });
  });

  void describe('transaction scoped locks', () => {
    void it('releases shared lock when transaction commits', async () => {
      // Given
      await pool.withTransaction(async (transaction) => {
        await insertProjection(transaction.execute, {
          name: 'test_commit',
          partition: defaultTag,
          version: 1,
          status: 'active',
        });
      });

      const lockKey = toProjectionLockKey({
        projectionName: 'test_commit',
        partition: defaultTag,
        version: 1,
      });

      const lock = postgreSQLProjectionLock({
        projectionName: 'test_commit',
        partition: defaultTag,
        version: 1,
      });

      const sharedLockHeld = asyncAwaiter();
      const exclusiveAttempted = asyncAwaiter();

      // When - verify exclusive fails during lock
      const [, exclusiveDuringLock] = await Promise.all([
        // Transaction A: acquire shared lock, wait for exclusive attempt, then commit
        pool.withTransaction(async (transaction) => {
          await lock.tryAcquire({ execute: transaction.execute });
          sharedLockHeld.resolve();
          await exclusiveAttempted.wait;
        }),
        // Attempt exclusive while lock is held
        (async () => {
          await sharedLockHeld.wait;
          const result = await tryAcquireExclusiveLock(pool.execute, lockKey);
          exclusiveAttempted.resolve();
          return result;
        })(),
      ]);

      // Then
      assertFalse(
        exclusiveDuringLock,
        'Expected exclusive lock to fail while shared lock is held',
      );

      // After commit, exclusive should succeed
      const exclusiveAfterCommit = await tryAcquireExclusiveLock(
        pool.execute,
        lockKey,
      );
      assertTrue(
        exclusiveAfterCommit,
        'Expected to acquire exclusive lock after transaction commit',
      );
    });

    void it('releases shared lock when transaction rolls back', async () => {
      // Given
      await pool.withTransaction(async (transaction) => {
        await insertProjection(transaction.execute, {
          name: 'test_rollback',
          partition: defaultTag,
          version: 1,
          status: 'active',
        });
      });

      const lockKey = toProjectionLockKey({
        projectionName: 'test_rollback',
        partition: defaultTag,
        version: 1,
      });

      const lock = postgreSQLProjectionLock({
        projectionName: 'test_rollback',
        partition: defaultTag,
        version: 1,
      });

      const sharedLockHeld = asyncAwaiter();
      const exclusiveAttempted = asyncAwaiter();

      // When - verify exclusive fails during lock
      const [, exclusiveDuringLock] = await Promise.all([
        // Transaction A: acquire shared lock, wait, then rollback via exception
        assertThrowsAsync(() =>
          pool.withTransaction(async (transaction) => {
            await lock.tryAcquire({ execute: transaction.execute });
            sharedLockHeld.resolve();
            await exclusiveAttempted.wait;
            throw new Error('Force rollback');
          }),
        ),
        // Attempt exclusive while lock is held
        (async () => {
          await sharedLockHeld.wait;
          const result = await tryAcquireExclusiveLock(pool.execute, lockKey);
          exclusiveAttempted.resolve();
          return result;
        })(),
      ]);

      // Then
      assertFalse(
        exclusiveDuringLock,
        'Expected exclusive lock to fail while shared lock is held',
      );

      // After rollback, exclusive should succeed
      const exclusiveAfterRollback = await tryAcquireExclusiveLock(
        pool.execute,
        lockKey,
      );
      assertTrue(
        exclusiveAfterRollback,
        'Expected to acquire exclusive lock after transaction rollback',
      );
    });
  });

  void describe('status checks', () => {
    void it('returns true when projection is active', async () => {
      // Given
      await insertProjection(pool.execute, {
        name: 'test_active',
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      const lock = postgreSQLProjectionLock({
        projectionName: 'test_active',
        partition: defaultTag,
        version: 1,
      });

      // When
      const result = await pool.withTransaction(async (transaction) => {
        return await lock.tryAcquire({ execute: transaction.execute });
      });

      // Then
      assertTrue(
        result,
        'Expected lock acquisition to succeed for active projection',
      );
    });

    void it('returns false when projection status is rebuilding', async () => {
      // Given
      await insertProjection(pool.execute, {
        name: 'test_rebuilding',
        partition: defaultTag,
        version: 1,
        status: 'async_processing',
      });

      const lock = postgreSQLProjectionLock({
        projectionName: 'test_rebuilding',
        partition: defaultTag,
        version: 1,
      });

      // When
      const result = await pool.withTransaction((transaction) =>
        lock.tryAcquire({ execute: transaction.execute }),
      );

      // Then
      assertFalse(
        result,
        'Expected lock acquisition to fail for rebuilding projection',
      );
    });

    void it('returns true when projection does not exist', async () => {
      // Given
      const lock = postgreSQLProjectionLock({
        projectionName: 'nonexistent',
        partition: defaultTag,
        version: 1,
      });

      // When
      const result = await pool.withTransaction((transaction) =>
        lock.tryAcquire({ execute: transaction.execute }),
      );

      // Then
      assertTrue(
        result,
        'Expected lock acquisition to succeed for non-existent projection',
      );
    });
  });
});

const insertProjection = async (
  execute: SQLExecutor,
  {
    name,
    partition,
    version,
    status,
  }: { name: string; status?: string; partition?: string; version?: number },
) => {
  await execute.query(
    sql(
      `INSERT INTO emt_projections (version, type, name, partition, kind, status, definition)
       VALUES (%s, %L, %L, %L, %L, %L, %L)`,
      version ?? 1,
      'I',
      name,
      partition ?? defaultTag,
      'inline',
      status ?? 'active',
      '{}',
    ),
  );
};

const tryAcquireExclusiveLock = async (
  execute: SQLExecutor,
  lockKey: string,
): Promise<boolean> => {
  const result = await execute.query<{ acquired: boolean }>(
    sql(
      `SELECT pg_try_advisory_xact_lock(%s::bigint) as acquired`,
      (await hashText(lockKey)).toString(),
    ),
  );
  return result.rows[0]?.acquired ?? false;
};

const acquireExclusiveLock = async (
  execute: SQLExecutor,
  lockKey: string,
): Promise<void> => {
  await execute.command(
    sql(
      `SELECT pg_advisory_lock(%s::bigint)`,
      (await hashText(lockKey)).toString(),
    ),
  );
};

const releaseExclusiveLock = async (
  execute: SQLExecutor,
  lockKey: string,
): Promise<void> => {
  await execute.command(
    sql(
      `SELECT pg_advisory_unlock(%s::bigint)`,
      (await hashText(lockKey)).toString(),
    ),
  );
};
