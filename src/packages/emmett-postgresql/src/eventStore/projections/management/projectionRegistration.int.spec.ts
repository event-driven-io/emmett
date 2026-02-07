import { dumbo, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { pgDatabaseDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertIsNull,
  assertMatches,
  assertTrue,
  asyncAwaiter,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { PostgreSQLProjectionHandlerContext } from '..';
import type { PostgresReadEventMetadata } from '../../postgreSQLEventStore';
import { createEventStoreSchema, defaultTag } from '../../schema';
import {
  activateProjection,
  deactivateProjection,
  readProjectionInfo,
  registerProjection,
} from './projectionManagement';

void describe('projectionRegistration', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: PgPool;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString, driver: pgDatabaseDriver });
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

  void describe('registerProjection', () => {
    for (const status of ['active', 'inactive'] as const) {
      const projections: ProjectionRegistration<
        'inline' | 'async',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      >[] = [
        {
          type: 'inline',
          projection: {
            name: `test_inline_${status}_${Date.now()}`,
            canHandle: ['TestEvent'],
            handle: async () => {},
          },
        },
        {
          type: 'async',
          projection: {
            name: `test_async_${status}_${Date.now()}`,
            version: 1,
            kind: 'pongo',
            canHandle: ['TestEvent'],
            handle: async () => {},
          },
        },
      ];
      for (const registration of projections) {
        void it(`registers ${status} ${registration.type} projection'`, async () => {
          // Given

          // When
          await registerProjection(pool.execute, {
            partition: defaultTag,
            status,
            registration,
          });

          // Then
          const info = await readProjectionInfo(pool.execute, {
            name: registration.projection.name!,
            partition: defaultTag,
            version: 1,
          });

          assertIsNotNull(info);
          assertIsNotNull(info.createdAt);
          assertIsNotNull(info.lastUpdated);
          assertMatches(info, {
            partition: defaultTag,
            status,
            registration: {
              type: registration.type,
              projection: {
                name: registration.projection.name!,
                version: registration.projection.version ?? 1,
                kind: registration.projection.kind ?? registration.type,
              },
            },
          });
        });
      }
    }

    void it('updates existing projection with the same version', async () => {
      // Given
      const projectionName = `test_update_${Date.now()}`;
      const partition = defaultTag;

      const initialRegistration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        type: 'inline',
        projection: {
          name: projectionName,
          canHandle: ['EventA'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition,
        status: 'active',
        registration: initialRegistration,
      });

      const updatedRegistration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        ...initialRegistration,
        projection: {
          ...initialRegistration.projection,
          canHandle: ['EventA', 'EventB'],
        },
      };

      // When
      await registerProjection(pool.execute, {
        partition,
        status: 'active',
        registration: updatedRegistration,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.registration.projection.name, projectionName);
      assertEqual(info.registration.projection.canHandle.length, 2);
    });

    void it('does NOT update existing projection when registering new version', async () => {
      // Given
      const projectionName = `test_update_${Date.now()}`;
      const partition = defaultTag;

      const initialRegistration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        type: 'inline',
        projection: {
          name: projectionName,
          canHandle: ['EventA'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition,
        status: 'active',
        registration: initialRegistration,
      });

      const updatedRegistration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        ...initialRegistration,
        projection: {
          ...initialRegistration.projection,
          version: 2,
          canHandle: ['EventA', 'EventB'],
        },
      };

      // When
      await registerProjection(pool.execute, {
        partition,
        status: 'active',
        registration: updatedRegistration,
      });

      const infoV1 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition,
        version: 1,
      });
      assertIsNotNull(infoV1);

      const infoV2 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition,
        version: 2,
      });

      assertIsNotNull(infoV2);
      assertEqual(infoV2.registration.projection.name, projectionName);
      assertEqual(infoV1.registration.projection.canHandle.length, 1);
      assertEqual(infoV2.registration.projection.canHandle.length, 2);
    });
  });

  void describe('activateProjection', () => {
    let projectionName: string;
    let createdAt: Date;

    beforeEach(async () => {
      projectionName = `test_activate_${Date.now()}`;

      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      const initialInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });
      assertIsNotNull(initialInfo);

      createdAt = initialInfo.lastUpdated;
    });

    void it('sets existing projection status to active and updates timestamp', async () => {
      // When
      const result = await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertTrue(result.activated);

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.status, 'active');

      const updatedTimestamp = new Date(info.lastUpdated).getTime();
      const originalTimestamp = new Date(createdAt).getTime();

      assertEqual(updatedTimestamp > originalTimestamp, true);
    });

    void it('does not update NOT existing projection', async () => {
      // When
      const result = await activateProjection(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertFalse(result.activated);

      const info = await readProjectionInfo(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      assertIsNull(info);
    });

    void it('does not update old projection version', async () => {
      // Given
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
        status: 'inactive',
      });

      // When
      const result = await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      // Then
      assertTrue(result.activated);

      const infoV1 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });
      const infoV2 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      assertIsNotNull(infoV1);
      assertEqual(infoV1.status, 'inactive');
      assertIsNotNull(infoV2);
      assertEqual(infoV2.status, 'active');
    });
  });

  void describe('activateProjection locking', () => {
    void it('allows sequential activations of the same projection', async () => {
      // Given - insert inactive projection
      const projectionName = `test_sequential_activate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      // When - sequential activations
      const result1 = await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const result2 = await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertTrue(result1.activated);
      assertTrue(result2.activated);
    });

    void it('returns false when concurrent activation attempts same projection', async () => {
      // Given
      const projectionName = `test_concurrent_activate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      const firstLockAcquired = asyncAwaiter();
      const secondAttempted = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await activateProjection(transaction.execute, {
            name: projectionName,
            partition: defaultTag,
            version: 1,
          });
          firstLockAcquired.resolve();
          await secondAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return activateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
          secondAttempted.resolve(result.activated);
          return result;
        })(),
      ]);

      // Then
      assertTrue(result1.activated);
      assertFalse(result2.activated);
    });

    void it('allows activation after previous transaction commits', async () => {
      // Given
      const projectionName = `test_after_commit_activate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      const firstCompleted = asyncAwaiter();

      // When
      const [result1, result2] = await Promise.all([
        (async () => {
          const result = await pool.withTransaction(async (transaction) => {
            return activateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
          firstCompleted.resolve();
          return result;
        })(),
        (async () => {
          await firstCompleted.wait;
          return pool.withTransaction(async (transaction) => {
            return activateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
        })(),
      ]);

      // Then
      assertTrue(result1.activated);
      assertTrue(result2.activated);
    });

    void it('allows concurrent activations of different projections', async () => {
      // Given
      const projectionName1 = `test_different_activate_1_${Date.now()}`;
      const projectionName2 = `test_different_activate_2_${Date.now()}`;

      await insertProjection(pool.execute, {
        name: projectionName1,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });
      await insertProjection(pool.execute, {
        name: projectionName2,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      const firstLockAcquired = asyncAwaiter();
      const secondLockAcquired = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await activateProjection(transaction.execute, {
            name: projectionName1,
            partition: defaultTag,
            version: 1,
          });
          firstLockAcquired.resolve();
          await secondLockAcquired.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return activateProjection(transaction.execute, {
              name: projectionName2,
              partition: defaultTag,
              version: 1,
            });
          });
          secondLockAcquired.resolve(result.activated);
          return result;
        })(),
      ]);

      // Then
      assertTrue(result1.activated);
      assertTrue(result2.activated);
    });
  });

  void describe('deactivateProjection', () => {
    let projectionName: string;
    let createdAt: Date;

    beforeEach(async () => {
      projectionName = `test_deactivate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });
      const initialInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });
      assertIsNotNull(initialInfo);

      createdAt = initialInfo.lastUpdated;
    });

    void it('set existing projection status to inactive', async () => {
      // When
      const result = await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertTrue(result.deactivated);

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.status, 'inactive');

      assertIsNotNull(info);

      assertEqual(
        new Date(info.lastUpdated).getTime() > createdAt.getTime(),
        true,
      );
    });

    void it('does not update NOT existing projection', async () => {
      // When
      const result = await deactivateProjection(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertFalse(result.deactivated);

      const info = await readProjectionInfo(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      assertIsNull(info);
    });

    void it('does not update old projection version', async () => {
      // Given
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
        status: 'active',
      });

      // When
      const result = await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      // Then
      assertTrue(result.deactivated);

      const infoV1 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });
      const infoV2 = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      assertIsNotNull(infoV1);
      assertEqual(infoV1.status, 'active');
      assertIsNotNull(infoV2);
      assertEqual(infoV2.status, 'inactive');
    });
  });

  void describe('deactivateProjection locking', () => {
    void it('allows sequential deactivations of the same projection', async () => {
      // Given - insert active projection
      const projectionName = `test_sequential_deactivate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      // When - sequential deactivations
      const result1 = await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const result2 = await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
      assertTrue(result1.deactivated);
      assertTrue(result2.deactivated);
    });

    void it('returns false when concurrent deactivation attempts same projection', async () => {
      // Given
      const projectionName = `test_concurrent_deactivate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      const firstLockAcquired = asyncAwaiter();
      const secondAttempted = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await deactivateProjection(transaction.execute, {
            name: projectionName,
            partition: defaultTag,
            version: 1,
          });
          firstLockAcquired.resolve();
          await secondAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return deactivateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
          secondAttempted.resolve(result.deactivated);
          return result;
        })(),
      ]);

      // Then
      assertTrue(result1.deactivated);
      assertFalse(result2.deactivated);
    });

    void it('allows deactivation after previous transaction commits', async () => {
      // Given
      const projectionName = `test_after_commit_deactivate_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      const firstCompleted = asyncAwaiter();

      // When
      const [result1, result2] = await Promise.all([
        (async () => {
          const result = await pool.withTransaction(async (transaction) => {
            return deactivateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
          firstCompleted.resolve();
          return result;
        })(),
        (async () => {
          await firstCompleted.wait;
          return pool.withTransaction(async (transaction) => {
            return deactivateProjection(transaction.execute, {
              name: projectionName,
              partition: defaultTag,
              version: 1,
            });
          });
        })(),
      ]);

      // Then
      assertTrue(result1.deactivated);
      assertTrue(result2.deactivated);
    });

    void it('allows concurrent deactivations of different projections', async () => {
      // Given
      const projectionName1 = `test_different_deactivate_1_${Date.now()}`;
      const projectionName2 = `test_different_deactivate_2_${Date.now()}`;

      await insertProjection(pool.execute, {
        name: projectionName1,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });
      await insertProjection(pool.execute, {
        name: projectionName2,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      const firstLockAcquired = asyncAwaiter();
      const secondLockAcquired = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await deactivateProjection(transaction.execute, {
            name: projectionName1,
            partition: defaultTag,
            version: 1,
          });
          firstLockAcquired.resolve();
          await secondLockAcquired.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return deactivateProjection(transaction.execute, {
              name: projectionName2,
              partition: defaultTag,
              version: 1,
            });
          });
          secondLockAcquired.resolve(result.deactivated);
          return result;
        })(),
      ]);

      // Then
      assertTrue(result1.deactivated);
      assertTrue(result2.deactivated);
    });
  });

  void describe('readProjectionInfo', () => {
    let projectionName: string;

    beforeEach(async () => {
      projectionName = `test_read_${Date.now()}`;
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });
      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
        status: 'active',
      });
    });

    void it('return specific projection version', async () => {
      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.registration.projection.version ?? 1, 1);
    });

    void it('should return null when projection not found', async () => {
      const info = await readProjectionInfo(pool.execute, {
        name: 'nonexistent_projection',
        partition: defaultTag,
        version: 1,
      });

      assertEqual(info, null);
    });
  });

  void describe('registerProjection locking', () => {
    const createRegistration = (
      name: string,
    ): ProjectionRegistration<
      'inline',
      PostgresReadEventMetadata,
      PostgreSQLProjectionHandlerContext
    > => ({
      type: 'inline',
      projection: {
        name,
        canHandle: ['TestEvent'],
        handle: async () => {},
      },
    });

    void it('allows sequential registrations of the same projection', async () => {
      // Given
      const projectionName = `test_sequential_${Date.now()}`;
      const registration = createRegistration(projectionName);

      // When
      const result1 = await registerProjection(pool.execute, {
        partition: defaultTag,
        status: 'active',
        registration,
      });

      const result2 = await registerProjection(pool.execute, {
        partition: defaultTag,
        status: 'active',
        registration,
      });

      // Then
      assertTrue(result1.registered, 'Expected first registration to succeed');
      assertTrue(
        result2.registered,
        'Expected second registration to succeed after first completed',
      );
    });

    void it('returns false when concurrent registration attempts same projection', async () => {
      // Given
      const projectionName = `test_concurrent_${Date.now()}`;
      const registration = createRegistration(projectionName);

      const firstLockAcquired = asyncAwaiter();
      const secondAttempted = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await registerProjection(transaction.execute, {
            partition: defaultTag,
            status: 'active',
            registration,
          });
          firstLockAcquired.resolve();
          await secondAttempted.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return registerProjection(transaction.execute, {
              partition: defaultTag,
              status: 'active',
              registration,
            });
          });
          secondAttempted.resolve(result.registered);
          return result;
        })(),
      ]);

      // Then
      assertTrue(
        result1.registered,
        'Expected first concurrent registration to succeed',
      );
      assertFalse(
        result2.registered,
        'Expected second concurrent registration to fail while first holds lock',
      );
    });

    void it('allows registration after previous transaction commits', async () => {
      // Given
      const projectionName = `test_after_commit_${Date.now()}`;
      const registration = createRegistration(projectionName);

      const firstCompleted = asyncAwaiter();

      // When
      const [result1, result2] = await Promise.all([
        (async () => {
          const result = await pool.withTransaction(async (transaction) => {
            return registerProjection(transaction.execute, {
              partition: defaultTag,
              status: 'active',
              registration,
            });
          });
          firstCompleted.resolve();
          return result;
        })(),
        (async () => {
          await firstCompleted.wait;
          return pool.withTransaction(async (transaction) => {
            return registerProjection(transaction.execute, {
              partition: defaultTag,
              status: 'active',
              registration,
            });
          });
        })(),
      ]);

      // Then
      assertTrue(result1.registered, 'Expected first registration to succeed');
      assertTrue(
        result2.registered,
        'Expected second registration to succeed after first transaction committed',
      );
    });

    void it('allows concurrent registrations of different projections', async () => {
      // Given
      const registration1 = createRegistration(
        `test_different_1_${Date.now()}`,
      );
      const registration2 = createRegistration(
        `test_different_2_${Date.now()}`,
      );

      const firstLockAcquired = asyncAwaiter();
      const secondLockAcquired = asyncAwaiter<boolean>();

      // When
      const [result1, result2] = await Promise.all([
        pool.withTransaction(async (transaction) => {
          const result = await registerProjection(transaction.execute, {
            partition: defaultTag,
            status: 'active',
            registration: registration1,
          });
          firstLockAcquired.resolve();
          await secondLockAcquired.wait;
          return result;
        }),
        (async () => {
          await firstLockAcquired.wait;
          const result = await pool.withTransaction(async (transaction) => {
            return registerProjection(transaction.execute, {
              partition: defaultTag,
              status: 'active',
              registration: registration2,
            });
          });
          secondLockAcquired.resolve(result.registered);
          return result;
        })(),
      ]);

      // Then
      assertTrue(
        result1.registered,
        'Expected first projection registration to succeed',
      );
      assertTrue(
        result2.registered,
        'Expected second projection registration to succeed (different projection)',
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
  await execute.command(
    SQL`INSERT INTO emt_projections (version, type, name, partition, kind, status, definition)
       VALUES (${version ?? 1}, 'i', ${name}, ${partition ?? defaultTag}, 'inline', ${status ?? 'active'}, '{}'::jsonb)`,
  );
};
