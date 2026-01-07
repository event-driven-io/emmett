import {
  dumbo,
  sql,
  type Dumbo,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertMatches,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createEventStoreSchema, defaultTag } from '..';
import type { PostgresReadEventMetadata } from '../../postgreSQLEventStore';
import type { PostgreSQLProjectionHandlerContext } from '../../projections';
import {
  activateProjection,
  deactivateProjection,
  readProjectionInfo,
  registerProjection,
} from './projectionRegistration';

void describe('projectionRegistration', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    const connectionString = postgres.getConnectionUri();
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
      await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
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
      await activateProjection(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      // Then
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
      await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      // Then
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
      await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      // Then
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
      await deactivateProjection(pool.execute, {
        name: 'non_existing_projection',
        partition: defaultTag,
        version: 1,
      });

      // Then
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
      await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 2,
      });

      // Then
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
    sql(
      `INSERT INTO emt_projections (version, type, name, partition, kind, status, definition)
       VALUES (%s, %L, %L, %L, %L, %L, %L)`,
      version ?? 1,
      'i',
      name,
      partition ?? defaultTag,
      'inline',
      status ?? 'active',
      '{}',
    ),
  );
};
