import {
  dumbo,
  sql,
  type Dumbo,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  type ProjectionDefinition,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
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
    void it('should register inline projection with defaults', async () => {
      const registration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        type: 'inline',
        projection: {
          name: 'test_inline',
          canHandle: ['TestEvent'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition: defaultTag,
        status: 'active',
        registration,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: 'test_inline',
        partition: defaultTag,
      });

      assertIsNotNull(info);
      assertDeepEqual(
        {
          name: info.name,
          version: info.version,
          type: info.type,
          kind: info.kind,
          status: info.status,
        },
        {
          name: 'test_inline',
          version: 1,
          type: 'i',
          kind: 'inline',
          status: 'active',
        },
      );
      assertIsNotNull(info.created_at);
      assertIsNotNull(info.last_updated);
    });

    void it('should register async projection with explicit version and kind', async () => {
      const registration: ProjectionRegistration<
        'async',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        type: 'async',
        projection: {
          name: 'test_async',
          version: 2,
          kind: 'pongo',
          canHandle: ['TestEvent'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition: defaultTag,
        status: 'inactive',
        registration,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: 'test_async',
        partition: defaultTag,
        version: 2,
      });

      assertIsNotNull(info);
      assertDeepEqual(
        {
          name: info.name,
          version: info.version,
          type: info.type,
          kind: info.kind,
          status: info.status,
        },
        {
          name: 'test_async',
          version: 2,
          type: 'a',
          kind: 'pongo',
          status: 'inactive',
        },
      );
    });

    void it('should update existing projection on conflict', async () => {
      const projectionName = 'test_update';
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
        type: 'inline',
        projection: {
          name: projectionName,
          canHandle: ['EventA', 'EventB'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition,
        status: 'active',
        registration: updatedRegistration,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition,
      });

      assertIsNotNull(info);
      assertEqual(info.name, projectionName);

      const definition = JSON.parse(info.definition) as ProjectionDefinition;
      assertEqual(definition.canHandle.length, 2);
    });

    void it('should not register projection without name', async () => {
      const registration: ProjectionRegistration<
        'inline',
        PostgresReadEventMetadata,
        PostgreSQLProjectionHandlerContext
      > = {
        type: 'inline',
        projection: {
          canHandle: ['TestEvent'],
          handle: async () => {},
        },
      };

      await registerProjection(pool.execute, {
        partition: defaultTag,
        status: 'active',
        registration,
      });

      const result = await pool.execute.query(
        sql(`SELECT COUNT(*) as count FROM emt_projections WHERE name IS NULL`),
      );

      assertEqual(result.rows[0]?.count, '0');
    });
  });

  void describe('activateProjection', () => {
    void it('should set projection status to active', async () => {
      const projectionName = 'test_activate';

      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.status, 'active');
    });

    void it('should update last_updated timestamp when activating', async () => {
      const projectionName = 'test_activate_timestamp';

      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'inactive',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
      });

      assertIsNotNull(beforeInfo);

      await activateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const afterInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
      });

      assertIsNotNull(afterInfo);

      const beforeTime = new Date(beforeInfo.last_updated).getTime();
      const afterTime = new Date(afterInfo.last_updated).getTime();

      assertEqual(afterTime > beforeTime, true);
    });
  });

  void describe('deactivateProjection', () => {
    void it('should set projection status to inactive', async () => {
      const projectionName = 'test_deactivate';

      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const info = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      assertIsNotNull(info);
      assertEqual(info.status, 'inactive');
    });

    void it('should update last_updated timestamp when deactivating', async () => {
      const projectionName = 'test_deactivate_timestamp';

      await insertProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
        status: 'active',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
      });

      assertIsNotNull(beforeInfo);

      await deactivateProjection(pool.execute, {
        name: projectionName,
        partition: defaultTag,
        version: 1,
      });

      const afterInfo = await readProjectionInfo(pool.execute, {
        name: projectionName,
        partition: defaultTag,
      });

      assertIsNotNull(afterInfo);

      const beforeTime = new Date(beforeInfo.last_updated).getTime();
      const afterTime = new Date(afterInfo.last_updated).getTime();

      assertEqual(afterTime > beforeTime, true);
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
