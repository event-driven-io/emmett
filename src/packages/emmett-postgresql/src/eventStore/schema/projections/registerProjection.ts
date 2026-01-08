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
    v_lock_acquired BOOLEAN;
BEGIN
    SELECT pg_try_advisory_xact_lock(p_lock_key) INTO v_lock_acquired;

    IF NOT v_lock_acquired THEN
        RETURN false;
    END IF;

    INSERT INTO ${projectionsTable.name} (
        name, partition, version, type, kind, status, definition, created_at, last_updated
    )
    VALUES (p_name, p_partition, p_version, p_type, p_kind, p_status, p_definition, now(), now())
    ON CONFLICT (name, partition, version) DO UPDATE
    SET definition = EXCLUDED.definition,
        last_updated = now();

    RETURN true;
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
BEGIN
    RETURN QUERY
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
    SELECT (SELECT COUNT(*) > 0 FROM update_result);
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
BEGIN
    RETURN QUERY
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
    SELECT (SELECT COUNT(*) > 0 FROM update_result);
END;
$emt_deactivate_projection$;
`,
);
