import {
  JSONSerializer,
  single,
  singleOrNull,
  SQL,
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
import {
  callActivateProjection,
  callDeactivateProjection,
  callRegisterProjection,
} from '../../schema/projections/registerProjection';
import { projectionsTable } from '../../schema/typing';
import { toProjectionLockKey } from '../locks/postgreSQLProjectionLock';

export const registerProjection = async <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
>(
  execute: SQLExecutor,
  options: {
    partition: string;
    status: 'active' | 'inactive';
    registration: ProjectionRegistration<
      ProjectionHandlingType,
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
      callRegisterProjection({
        lockKey: lockKeyBigInt.toString(),
        name: name!,
        partition,
        version,
        type,
        kind,
        status,
        definition,
      }),
    ),
  );

  return { registered };
};

export const activateProjection = async (
  execute: SQLExecutor,
  options: { name: string; partition: string; version: number },
): Promise<{ activated: boolean }> => {
  const { name, partition, version } = options;

  const lockKey = toProjectionLockKey({
    projectionName: name,
    partition,
    version,
  });

  const lockKeyBigInt = await hashText(lockKey);

  const { activated } = await single<{ activated: boolean }>(
    execute.query(
      callActivateProjection({
        lockKey: lockKeyBigInt.toString(),
        name,
        partition,
        version,
      }),
    ),
  );

  return { activated };
};

export const deactivateProjection = async (
  execute: SQLExecutor,
  options: { name: string; partition: string; version: number },
): Promise<{ deactivated: boolean }> => {
  const { name, partition, version } = options;

  const lockKey = toProjectionLockKey({
    projectionName: name,
    partition,
    version,
  });

  const lockKeyBigInt = await hashText(lockKey);

  const { deactivated } = await single<{ deactivated: boolean }>(
    execute.query(
      callDeactivateProjection({
        lockKey: lockKeyBigInt.toString(),
        name,
        partition,
        version,
      }),
    ),
  );

  return { deactivated };
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
      SQL`SELECT name, version, type, kind, status, definition, created_at, last_updated
           FROM ${SQL.identifier(projectionsTable.name)}
           WHERE name = ${name} AND partition = ${partition} AND version = ${version}`,
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
