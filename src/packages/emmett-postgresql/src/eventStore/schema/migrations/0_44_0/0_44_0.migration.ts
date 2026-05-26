import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { defaultTag, processorsTable, unknownTag } from '../../typing';

// Removes the mixed-format checkpoint fallback from store_processor_checkpoint.
// All deployments that ran 0.43.0 have their checkpoints migrated to txid:globalpos format,
// so the blue-green compat code is no longer needed.
const migration_0_44_0_cleanupObsoleteCheckpointCompatSQL = SQL`
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT '${SQL.plain(defaultTag)}',
  p_processor_instance_id  TEXT DEFAULT '${SQL.plain(unknownTag)}'
) RETURNS INT AS $spc$
DECLARE
  current_position TEXT;
BEGIN
  IF p_check_position IS NOT NULL THEN
      UPDATE "${SQL.plain(processorsTable.name)}"
      SET
        "last_processed_checkpoint" = p_position,
        "last_processed_transaction_id" = p_transaction_id,
        "last_updated" = now()
      WHERE "processor_id" = p_processor_id
        AND "last_processed_checkpoint" = p_check_position
        AND "partition" = p_partition
        AND "version" = p_version;

      IF FOUND THEN
          RETURN 1;
      END IF;

      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${SQL.plain(processorsTable.name)}"
      WHERE "processor_id" = p_processor_id
        AND "partition" = p_partition
        AND "version" = p_version;

      IF current_position = p_position THEN
          RETURN 0;
      ELSIF current_position > p_position THEN
          RETURN 3;
      ELSE
          RETURN 2;
      END IF;
  END IF;

  BEGIN
      INSERT INTO "${SQL.plain(processorsTable.name)}"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
      VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());
      RETURN 1;
  EXCEPTION WHEN unique_violation THEN
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${SQL.plain(processorsTable.name)}"
      WHERE "processor_id" = p_processor_id
        AND "partition" = p_partition
        AND "version" = p_version;

      IF current_position = p_position THEN
          RETURN 0;
      ELSIF current_position > p_position THEN
          RETURN 3;
      ELSE
          RETURN 2;
      END IF;
  END;
END;
$spc$ LANGUAGE plpgsql;
`;

export const migration_0_44_0_cleanupObsoleteCheckpointCompat: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.44.0:cleanup-obsolete-checkpoint-compat',
    [migration_0_44_0_cleanupObsoleteCheckpointCompatSQL],
  );
