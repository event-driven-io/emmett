import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import {
  defaultTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  unknownTag,
} from '../../typing';

const migration_0_43_0_cleanupLegacySubscriptionSQL = SQL`
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
    -- Restore clean emt_add_partition (remove creation of emt_subscriptions partitions)
    CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $fnpar$
    BEGIN                
        PERFORM emt_add_table_partition('${SQL.plain(messagesTable.name)}', partition_name);
        PERFORM emt_add_table_partition('${SQL.plain(streamsTable.name)}', partition_name);
    
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (%L);',
            emt_sanitize_name('${SQL.plain(processorsTable.name)}' || '_' || partition_name), '${SQL.plain(processorsTable.name)}', partition_name
        );
    
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (%L);',
            emt_sanitize_name('${SQL.plain(projectionsTable.name)}' || '_' || partition_name), '${SQL.plain(projectionsTable.name)}', partition_name
        );
    END;
    $fnpar$ LANGUAGE plpgsql;

    -- Drop old subscriptions table if it exists
    DROP TABLE IF EXISTS emt_subscriptions CASCADE;

    -- Drop old function if it exists
    DROP FUNCTION IF EXISTS store_subscription_checkpoint(character varying, bigint, bigint, bigint, xid8, text);
    
    -- Restore clean store_processor_checkpoint (remove dual-write logic)
    CREATE OR REPLACE FUNCTION store_processor_checkpoint(
      p_processor_id           TEXT,
      p_version                BIGINT,
      p_position               TEXT,
      p_check_position         TEXT,
      p_transaction_id         xid8,
      p_partition              TEXT DEFAULT '${SQL.plain(defaultTag)}',
      p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
    ) RETURNS INT AS $fn$
    DECLARE
      current_position TEXT;
    BEGIN
      IF p_check_position IS NOT NULL THEN
          UPDATE "emt_processors"
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
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id 
            AND "partition" = p_partition            
            AND "version" = p_version ;

          IF current_position = p_position THEN
              RETURN 0;
          ELSIF current_position > p_position THEN
              RETURN 3;
          ELSE
              RETURN 2;
          END IF;
      END IF;

      BEGIN
          INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
          VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());
          RETURN 1;
      EXCEPTION WHEN unique_violation THEN
          SELECT "last_processed_checkpoint" INTO current_position
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id 
            AND "partition" = p_partition
            AND "version" = p_version;

          IF current_position = p_position THEN
              RETURN 0;
          ELSE
              RETURN 2;
          END IF;
      END;
    END;
    $fn$ LANGUAGE plpgsql;
END IF;
END $$;
`;

export const migration_0_43_0_cleanupLegacySubscription: SQLMigration =
  sqlMigration('emt:postgresql:eventstore:0.43.0:cleanup-legacy-subscription', [
    migration_0_43_0_cleanupLegacySubscriptionSQL,
  ]);

// Updates store_processor_checkpoint to handle mixed-format checkpoints during
// blue-green deployment when old code (plain globalpos) and new code (txid:globalpos) coexist.
// TODO: Remove the mixed-format fallback block in a future release once all deployments
// have run the 0.43.0 checkpoint format upgrade migration.
const migration_0_43_0_updateStoreProcessorCheckpointSQL = SQL`
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

      -- TODO: Remove once all deployments have run the 0.43.0 migration.
      -- Handles mixed-format scenarios during blue-green deployment.
      IF p_check_position LIKE '%:%' THEN
          -- new code, stored value still in old format (plain globalpos)
          UPDATE "${SQL.plain(processorsTable.name)}"
          SET
            "last_processed_checkpoint" = p_position,
            "last_processed_transaction_id" = p_transaction_id,
            "last_updated" = now()
          WHERE "processor_id" = p_processor_id
            AND "last_processed_checkpoint" = split_part(p_check_position, ':', 2)
            AND "last_processed_checkpoint" NOT LIKE '%:%'
            AND "partition" = p_partition
            AND "version" = p_version;
      ELSE
          -- old code, stored value already migrated to new format (txid:globalpos)
          UPDATE "${SQL.plain(processorsTable.name)}"
          SET
            "last_processed_checkpoint" = p_position,
            "last_processed_transaction_id" = p_transaction_id,
            "last_updated" = now()
          WHERE "processor_id" = p_processor_id
            AND split_part("last_processed_checkpoint", ':', 2) = p_check_position
            AND "last_processed_checkpoint" LIKE '%:%'
            AND "partition" = p_partition
            AND "version" = p_version;
      END IF;

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

export const migration_0_43_0_updateStoreProcessorCheckpoint: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.43.0:update-store-processor-checkpoint',
    [migration_0_43_0_updateStoreProcessorCheckpointSQL],
  );

// Upgrades last_processed_checkpoint from plain globalPosition (e.g. "00000000000000000042")
// to the composite transactionId:globalPosition format (e.g. "00000000000000000001:00000000000000000042").
// Rows already in the new format (containing ':') are skipped.
// Wrapped in an existence check so it is safe to run before the initial schema migration on fresh databases.
const migration_0_43_0_upgradeCheckpointFormatSQL = SQL`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '${SQL.plain(processorsTable.name)}') THEN
    UPDATE "${SQL.plain(processorsTable.name)}" p
    SET last_processed_checkpoint =
      lpad(m.transaction_id::text, 20, '0') || ':' || p.last_processed_checkpoint
    FROM "${SQL.plain(messagesTable.name)}" m
    WHERE m.global_position = p.last_processed_checkpoint::bigint
      AND p.last_processed_checkpoint NOT LIKE '%:%';
  END IF;
END $$;
`;

export const migration_0_43_0_upgradeCheckpointFormat: SQLMigration =
  sqlMigration('emt:postgresql:eventstore:0.43.0:upgrade-checkpoint-format', [
    migration_0_43_0_upgradeCheckpointFormatSQL,
  ]);
