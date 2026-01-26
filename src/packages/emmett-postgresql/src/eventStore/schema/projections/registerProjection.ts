import { sql } from '@event-driven-io/dumbo';
import { createFunctionIfDoesNotExistSQL } from '../createFunctionIfDoesNotExist';
import { projectionsTable } from '../typing';

export const registerProjectionSQL = createFunctionIfDoesNotExistSQL(
  'emt_register_projection',
  `
CREATE OR REPLACE FUNCTION emt_register_projection(
    p_lock_key      BIGINT,
    p_name          TEXT,
    p_partition     TEXT,
    p_version       INT,
    p_type          VARCHAR(1),
    p_kind          TEXT,
    p_status        TEXT,
    p_definition    JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_register_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    upsert_result AS (
        INSERT INTO ${projectionsTable.name} (
            name, partition, version, type, kind, status, definition, created_at, last_updated
        )
        SELECT p_name, p_partition, p_version, p_type, p_kind, p_status, p_definition, now(), now()
        WHERE (SELECT lock_acquired FROM lock_check) = true
        ON CONFLICT (name, partition, version) DO UPDATE
        SET definition = EXCLUDED.definition,
            last_updated = now()
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM upsert_result;

    RETURN v_result;
END;
$emt_register_projection$;
`,
);

export const activateProjectionSQL = createFunctionIfDoesNotExistSQL(
  'emt_activate_projection',
  `
CREATE OR REPLACE FUNCTION emt_activate_projection(
    p_lock_key   BIGINT,
    p_name       TEXT,
    p_partition  TEXT,
    p_version    INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_activate_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    update_result AS (
        UPDATE ${projectionsTable.name}
        SET status = 'active',
            last_updated = now()
        WHERE name = p_name
          AND partition = p_partition
          AND version = p_version
          AND (SELECT lock_acquired FROM lock_check) = true
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM update_result;

    RETURN v_result;
END;
$emt_activate_projection$;
`,
);

export const deactivateProjectionSQL = createFunctionIfDoesNotExistSQL(
  'emt_deactivate_projection',
  `
CREATE OR REPLACE FUNCTION emt_deactivate_projection(
    p_lock_key   BIGINT,
    p_name       TEXT,
    p_partition  TEXT,
    p_version    INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_deactivate_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    update_result AS (
        UPDATE ${projectionsTable.name}
        SET status = 'inactive',
            last_updated = now()
        WHERE name = p_name
          AND partition = p_partition
          AND version = p_version
          AND (SELECT lock_acquired FROM lock_check) = true
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM update_result;

    RETURN v_result;
END;
$emt_deactivate_projection$;
`,
);

type CallRegisterProjectionParams = {
  lockKey: string;
  name: string;
  partition: string;
  version: number;
  type: 'i' | 'a';
  kind: string;
  status: string;
  definition: string;
};

export const callRegisterProjection = (
  params: CallRegisterProjectionParams,
) =>
  sql(
    `SELECT emt_register_projection(%s, %L, %L, %s, %L, %L, %L, %L) AS registered`,
    params.lockKey,
    params.name,
    params.partition,
    params.version,
    params.type,
    params.kind,
    params.status,
    params.definition,
  );

type CallActivateProjectionParams = {
  lockKey: string;
  name: string;
  partition: string;
  version: number;
};

export const callActivateProjection = (
  params: CallActivateProjectionParams,
) =>
  sql(
    `SELECT emt_activate_projection(%s, %L, %L, %s) AS activated`,
    params.lockKey,
    params.name,
    params.partition,
    params.version,
  );

type CallDeactivateProjectionParams = {
  lockKey: string;
  name: string;
  partition: string;
  version: number;
};

export const callDeactivateProjection = (
  params: CallDeactivateProjectionParams,
) =>
  sql(
    `SELECT emt_deactivate_projection(%s, %L, %L, %s) AS deactivated`,
    params.lockKey,
    params.name,
    params.partition,
    params.version,
  );
