import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { bigInt } from '@event-driven-io/emmett';
import type { EventStoreDatabaseSchemaOptions } from '../../eventStoreDatabaseSchema';
import { postgreSQLFunctionName } from '../../postgreSQLFunctionName';
import {
  defaultTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  tableReference,
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

// Updates store_processor_checkpoint so the first checkpoint stored without a previous
// checkpoint replaces the placeholder row created by emt_try_acquire_processor_lock,
// instead of failing with a mismatch.
const migration_0_43_0_storeFirstCheckpointOverLockPlaceholderSQL = SQL`
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
      UPDATE "${SQL.plain(processorsTable.name)}"
      SET
        "last_processed_checkpoint" = p_position,
        "last_processed_transaction_id" = p_transaction_id,
        "last_updated" = now()
      WHERE "processor_id" = p_processor_id
        AND "last_processed_checkpoint" = '${SQL.plain(bigInt.toNormalizedString(0n))}'
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
  END;
END;
$spc$ LANGUAGE plpgsql;
`;

export const migration_0_43_0_storeFirstCheckpointOverLockPlaceholder: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.43.0:store-first-checkpoint-over-lock-placeholder',
    [migration_0_43_0_storeFirstCheckpointOverLockPlaceholderSQL],
  );

// Upgrades last_processed_checkpoint from plain globalPosition (e.g. "00000000000000000042")
// to the composite transactionId:globalPosition format (e.g. "00000000000000000001:00000000000000000042").
// Rows already in the new format (containing ':') are skipped.
// Wrapped in an existence check so it is safe to run before the initial schema migration on fresh databases.
const migration_0_43_0_upgradeCheckpointFormatSQL = SQL`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = '${SQL.plain(processorsTable.name)}') THEN
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
  sqlMigration(
    'emt:postgresql:eventstore:0.43.0:upgrade-checkpoint-format',
    [migration_0_43_0_upgradeCheckpointFormatSQL],
    { ignoreHashMismatch: true },
  );

// Matches the consumer poll's cursor and ORDER BY, so its LIMIT stops the scan
// instead of top-N sorting the partition on every tick - including the caught-up poll
// that returns nothing. Also serves readLastCommittedMessageCheckpoint in reverse.
//
// partition/is_archived are omitted deliberately: emt_messages is partitioned by both,
// so they are constant within every leaf this index is created on.
//
// Wrapped in an existence check so it is safe to run before the initial schema
// migration on fresh databases.
//
// Takes a ShareLock on the parent and every leaf, blocking writes while it builds.
// CREATE INDEX CONCURRENTLY cannot replace it: PostgreSQL rejects it on a partitioned
// table, and it cannot run inside the migration transaction.
//
// The DROP is for databases coming from the 0.42.x backport, which also indexes
// global_position alone. That was reachable while the cursor was a plain
// global_position >= comparison; the row comparison here can only seek an index led by
// transaction_id, so it would be maintained on every append and never read.
const migration_0_43_0_addMessagesPollIndexSQL = SQL`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = '${SQL.plain(messagesTable.name)}') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_transaction_id_global_position
      ON ${SQL.plain(messagesTable.name)}(transaction_id, global_position)';

    EXECUTE 'DROP INDEX IF EXISTS idx_messages_global_position';
  END IF;
END $$;
`;

export const migration_0_43_0_addMessagesPollIndex: SQLMigration = sqlMigration(
  'emt:postgresql:eventstore:0.43.0:add-messages-poll-index',
  [migration_0_43_0_addMessagesPollIndexSQL],
  { ignoreHashMismatch: true },
);

const migration_0_43_0_enforceStreamExistenceSQLFor = (
  databaseSchemaName?: string,
) => SQL`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ${databaseSchemaName === undefined ? SQL`current_schema()` : SQL.literal(databaseSchemaName)}
      AND p.proname = 'emt_append_to_stream'
  ) THEN
  CREATE OR REPLACE FUNCTION ${postgreSQLFunctionName(databaseSchemaName, 'emt_append_to_stream')}(
      v_message_ids text[],
      v_messages_data jsonb[],
      v_messages_metadata jsonb[],
      v_message_schema_versions text[],
      v_message_types text[],
      v_message_kinds text[],
      v_stream_id text,
      v_stream_type text,
      v_expected_stream_position bigint DEFAULT NULL,
      v_partition text DEFAULT ${postgreSQLFunctionName(databaseSchemaName, 'emt_sanitize_name')}('default_partition')
  ) RETURNS TABLE (
      success boolean,
      next_stream_position bigint,
      global_positions bigint[],
      transaction_id xid8
  ) LANGUAGE plpgsql
  AS $emt_append_to_stream$
  DECLARE
      v_next_stream_position bigint;
      v_updated_rows int;
      v_transaction_id xid8;
      v_global_positions bigint[];
  BEGIN
      v_transaction_id := pg_current_xact_id();

      IF v_expected_stream_position IS NULL THEN
          SELECT COALESCE(
            (SELECT stream_position
            FROM ${tableReference(databaseSchemaName, 'emt_streams')}
            WHERE stream_id = v_stream_id
              AND partition = v_partition
              AND is_archived = FALSE
            LIMIT 1),
            0
        ) INTO v_expected_stream_position;
      END IF;

      v_next_stream_position := v_expected_stream_position + array_upper(v_messages_data, 1);

      IF v_expected_stream_position = -1 THEN
          UPDATE ${tableReference(databaseSchemaName, 'emt_streams')} as s
          SET stream_position = s.stream_position + array_upper(v_messages_data, 1)
          WHERE stream_id = v_stream_id AND partition = v_partition AND is_archived = FALSE
          RETURNING s.stream_position INTO v_next_stream_position;

          IF NOT FOUND THEN
              RETURN QUERY SELECT FALSE, NULL::bigint, NULL::bigint[], NULL::xid8;
              RETURN;
          END IF;

          v_expected_stream_position := v_next_stream_position - array_upper(v_messages_data, 1);
      ELSIF v_expected_stream_position = 0 THEN
          INSERT INTO ${tableReference(databaseSchemaName, 'emt_streams')}
              (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
          VALUES
              (v_stream_id, v_next_stream_position, v_partition, v_stream_type, '{}', FALSE);
      ELSE
          UPDATE ${tableReference(databaseSchemaName, 'emt_streams')} as s
          SET stream_position = v_next_stream_position
          WHERE stream_id = v_stream_id AND stream_position = v_expected_stream_position AND partition = v_partition AND is_archived = FALSE;

          get diagnostics v_updated_rows = row_count;

          IF v_updated_rows = 0 THEN
              RETURN QUERY SELECT FALSE, NULL::bigint, NULL::bigint[], NULL::xid8;
              RETURN;
          END IF;
      END IF;

      WITH ev AS (
          SELECT row_number() OVER () + v_expected_stream_position AS stream_position,
                message_data,
                message_metadata,
                schema_version,
                message_id,
                message_type,
                message_kind
          FROM (
              SELECT *
              FROM
                unnest(v_message_ids, v_messages_data, v_messages_metadata, v_message_schema_versions, v_message_types, v_message_kinds)
              AS message(message_id, message_data, message_metadata, schema_version, message_type, message_kind)
          ) AS message
      ),
      all_messages_insert AS (
          INSERT INTO ${tableReference(databaseSchemaName, 'emt_messages')}
              (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
          SELECT
              v_stream_id, ev.stream_position, v_partition, ev.message_data, ev.message_metadata, ev.schema_version, ev.message_type, ev.message_kind, ev.message_id, v_transaction_id
          FROM ev
          RETURNING global_position
      )
      SELECT
          array_agg(global_position ORDER BY global_position) INTO v_global_positions
      FROM
          all_messages_insert;

      RETURN QUERY SELECT TRUE, v_next_stream_position, v_global_positions, v_transaction_id;
  END;
  $emt_append_to_stream$;
  END IF;
END $$;
`;

export const migration_0_43_0_enforceStreamExistenceFor = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLMigration =>
  sqlMigration('emt:postgresql:eventstore:0.43.0:enforce-stream-existence', [
    migration_0_43_0_enforceStreamExistenceSQLFor(options?.databaseSchemaName),
  ]);

export const migration_0_43_0_enforceStreamExistence =
  migration_0_43_0_enforceStreamExistenceFor();
