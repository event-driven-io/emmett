import {
  JSONSerializer,
  single,
  singleOrNull,
  sql,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  hashText,
  type AnyReadEventMetadata,
  type DefaultRecord,
  type ProjectionDefinition,
  type ProjectionHandlingType,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
import { toProjectionLockKey } from '../../projections/locks/tryAcquireProjectionLock';
import { projectionsTable } from '../typing';

export const registerProjection = async <
  HandlingType extends ProjectionHandlingType,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
>(
  execute: SQLExecutor,
  options: {
    partition: string;
    status: 'active' | 'inactive';
    registration: ProjectionRegistration<
      HandlingType,
      ReadEventMetadataType,
      ProjectionHandlerContext
    >;
  },
): Promise<{ registered: boolean }> => {
  const { partition, status, registration } = options;

  const type = registration.type === 'inline' ? 'i' : 'a';
  const name = registration.projection.name;
  const version = registration.projection.version ?? 1;
  const kind = registration.projection.kind ?? registration.type;
  const definition = JSONSerializer.serialize(registration.projection);

  const lockKey = toProjectionLockKey({
    projectionName: name!,
    partition,
    version,
  });

  const lockKeyBigInt = await hashText(lockKey);

  const { registered } = await single<{ registered: boolean }>(
    execute.query(
      sql(
        `SELECT emt_register_projection(%s, %L, %L, %s, %L, %L, %L, %L) AS registered`,
        lockKeyBigInt.toString(),
        name,
        partition,
        version,
        type,
        kind,
        status,
        definition,
      ),
    ),
  );

  return { registered };
};

export const activateProjection = async (
  execute: SQLExecutor,
  options: { name: string; partition: string; version: number },
): Promise<void> => {
  const { name, partition, version } = options;

  await execute.command(
    sql(
      `UPDATE ${projectionsTable.name}
       SET status = 'active',
           last_updated = now()
       WHERE name = %L
         AND partition = %L
         AND version = %s;`,
      name,
      partition,
      version,
    ),
  );
};

export const deactivateProjection = async (
  execute: SQLExecutor,
  options: { name: string; partition: string; version: number },
): Promise<void> => {
  const { name, partition, version } = options;

  await execute.command(
    sql(
      `UPDATE ${projectionsTable.name}
       SET status = 'inactive',
           last_updated = now()
       WHERE name = %L
         AND partition = %L
         AND version = %s;`,
      name,
      partition,
      version,
    ),
  );
};

type ProjectionRegistrationWithMandatoryData =
  ProjectionRegistration<ProjectionHandlingType> & {
    projection: Required<
      Pick<ProjectionDefinition, 'kind' | 'version' | 'name'>
    >;
  };

export type ReadProjectionInfoResult = {
  partition: string;
  status: 'active' | 'inactive';
  registration: ProjectionRegistrationWithMandatoryData;
  createdAt: Date;
  lastUpdated: Date;
};

type RawProjectionRow = {
  name: string;
  version: number;
  type: string;
  kind: string;
  status: string;
  definition: ProjectionRegistrationWithMandatoryData['projection'];
  created_at: Date;
  last_updated: Date;
};

export const readProjectionInfo = async (
  execute: SQLExecutor,
  {
    name,
    partition,
    version,
  }: { name: string; partition: string; version: number },
): Promise<ReadProjectionInfoResult | null> => {
  const row = await singleOrNull<RawProjectionRow>(
    execute.query(
      sql(
        `SELECT name, version, type, kind, status, definition, created_at, last_updated
           FROM ${projectionsTable.name}
           WHERE name = %L AND partition = %L AND version = %s`,
        name,
        partition,
        version,
      ),
    ),
  );

  return row
    ? {
        partition,
        status: row.status as 'active' | 'inactive',
        registration: {
          type: row.type === 'i' ? 'inline' : 'async',
          projection: {
            ...row.definition,
            name: row.name,
            version: row.version,
            kind: row.kind,
          },
        },
        createdAt: row.created_at,
        lastUpdated: row.last_updated,
      }
    : null;
};
