import { createFunctionIfDoesNotExistSQL } from '../createFunctionIfDoesNotExist';
import { projectionsTable } from '../typing';

export const registerProjectionWithLockSQL = createFunctionIfDoesNotExistSQL(
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
