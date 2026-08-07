import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import {
  defaultTag,
  messagesTable,
  processorsTable,
  unknownTag,
} from '../../typing';

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

// Matches the consumer poll's cursor and ORDER BY, so its LIMIT stops the scan
// instead of top-N sorting the partition on every tick - including the caught-up poll
// that returns nothing. Also serves readLastCommittedMessageCheckpoint in reverse.
//
// partition/is_archived are omitted deliberately: emt_messages is partitioned by both,
// so they are constant within every leaf this index is created on.
//
// Wired after schemaMigration (see ../index.ts) rather than added to messagesTableSQL,
// because schemaSQL is hashed into the shipped 'initial' migration.
//
// Takes a ShareLock on the parent and every leaf, blocking writes while it builds.
// CREATE INDEX CONCURRENTLY cannot replace it: PostgreSQL rejects it on a partitioned
// table, and it cannot run inside the migration transaction.
//
// The DROP is for databases coming from the 0.42.3 backport, which also indexes
// global_position alone. That was reachable while the cursor was a plain
// global_position >= comparison; the row comparison here can only seek an index led by
// transaction_id, so it would be maintained on every append and never read.
const migration_0_44_0_addMessagesPollIndexSQL = SQL`
CREATE INDEX IF NOT EXISTS idx_messages_transaction_id_global_position
ON ${SQL.identifier(messagesTable.name)}(transaction_id, global_position);

DROP INDEX IF EXISTS idx_messages_global_position;
`;

export const migration_0_44_0_addMessagesPollIndex: SQLMigration = sqlMigration(
  'emt:postgresql:eventstore:0.44.0:add-messages-poll-index',
  [migration_0_44_0_addMessagesPollIndexSQL],
);
