import { sql, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  JSONParser,
  type AnyReadEventMetadata,
  type DefaultRecord,
  type ProjectionHandlingType,
  type ProjectionRegistration,
} from '@event-driven-io/emmett';
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
): Promise<void> => {
  const { partition, status, registration } = options;

  const type = registration.type === 'inline' ? 'i' : 'a';
  const name = registration.projection.name;
  const version = registration.projection.version ?? 1;
  const kind = registration.projection.kind ?? registration.type;
  const definition = JSONParser.stringify(registration.projection);

  if (!name) {
    return;
  }

  await execute.command(
    sql(
      `INSERT INTO ${projectionsTable.name} (
        name,
        partition,
        version,
        type,
        kind,
        status,
        definition,
        created_at,
        last_updated
      )
      VALUES (%L, %L, %s, %L, %L, %L, %L, now(), now())
      ON CONFLICT (name, partition, version) DO UPDATE
      SET definition = EXCLUDED.definition,
          last_updated = now();`,
      name,
      partition,
      version,
      type,
      kind,
      status,
      definition,
    ),
  );
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

export type ProjectionInfo = {
  name: string;
  version: number;
  type: string;
  kind: string;
  status: string;
  definition: string;
  created_at: Date;
  last_updated: Date;
};

export const readProjectionInfo = async (
  execute: SQLExecutor,
  options: { name: string; partition: string; version?: number },
): Promise<ProjectionInfo | null> => {
  const { name, partition, version } = options;

  const result = await execute.query<ProjectionInfo>(
    version !== undefined
      ? sql(
          `SELECT name, version, type, kind, status, definition::text as definition, created_at, last_updated
           FROM ${projectionsTable.name}
           WHERE name = %L AND partition = %L AND version = %s`,
          name,
          partition,
          version,
        )
      : sql(
          `SELECT name, version, type, kind, status, definition::text as definition, created_at, last_updated
           FROM ${projectionsTable.name}
           WHERE name = %L AND partition = %L`,
          name,
          partition,
        ),
  );

  return result.rows[0] ?? null;
};
