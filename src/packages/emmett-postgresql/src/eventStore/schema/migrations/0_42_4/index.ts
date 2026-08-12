import {
  rawSql,
  sqlMigration,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import {
  defaultTag,
  messagesTable,
  processorsTable,
  unknownTag,
} from '../../typing';

// emt_messages carries no index beyond its primary key, so the consumer poll scans and
// sorts the whole partition on every tick, including the caught-up poll that returns
// nothing.
//
// Two indexes, because this version's poll filters on global_position directly
// (AND global_position >= cursor) while ordering by transaction_id, global_position:
//   - (global_position) serves the caught-up and slightly-behind polls, where the only
//     selective term is the cursor; transaction_id < xmin matches nearly every row.
//   - (transaction_id, global_position) matches the ORDER BY, so a backlogged consumer
//     can stop the scan at the LIMIT instead of sorting everything past the cursor.
// Neither covers both cases, so the planner is left to choose per cursor position.
//
// 0.43.0 rewrites the cursor as a row comparison on (transaction_id, global_position),
// which makes the composite sufficient and (global_position) unreachable; the 0.43.0
// migration drops it.
//
// Wrapped in an existence check so it is safe to run before the initial schema
// migration on fresh databases.
//
// partition/is_archived are omitted deliberately: emt_messages is partitioned by both,
// so they are constant within every leaf these indexes are created on.
//
// Takes a ShareLock on the parent and every leaf, blocking writes while they build.
// CREATE INDEX CONCURRENTLY cannot replace this: PostgreSQL rejects it on a partitioned
// table, and it cannot run inside the migration transaction.
const migration_0_42_4_addMessagesPollIndexesSQL = rawSql(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '${messagesTable.name}') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_global_position
      ON ${messagesTable.name}(global_position)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_transaction_id_global_position
      ON ${messagesTable.name}(transaction_id, global_position)';
  END IF;
END $$;
`);

export const migration_0_42_4_addMessagesPollIndexes: SQLMigration =
  sqlMigration('emt:postgresql:eventstore:0.42.4:add-messages-poll-indexes', [
    migration_0_42_4_addMessagesPollIndexesSQL,
  ]);

const noLegacySubscriptionBridgeSQL = `
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT '${defaultTag}',
  p_processor_instance_id  TEXT DEFAULT '${unknownTag}'
) RETURNS INT AS $spc$
DECLARE
  current_position TEXT;
BEGIN
  IF p_check_position IS NOT NULL THEN
      UPDATE "${processorsTable.name}"
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
      -- Handles mixed-format checkpoints during blue-green deployment.
      IF p_check_position LIKE '%:%' THEN
          -- New code, stored value still in old format (plain global position).
          UPDATE "${processorsTable.name}"
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
          -- Old code, stored value already in new format (txid:globalpos).
          UPDATE "${processorsTable.name}"
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
      FROM "${processorsTable.name}"
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
      INSERT INTO "${processorsTable.name}"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
      VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());
      RETURN 1;
  EXCEPTION WHEN unique_violation THEN
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "${processorsTable.name}"
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

const legacySubscriptionBridgeSQL = `
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
  CREATE OR REPLACE FUNCTION store_processor_checkpoint(
    p_processor_id           TEXT,
    p_version                BIGINT,
    p_position               TEXT,
    p_check_position         TEXT,
    p_transaction_id         xid8,
    p_partition              TEXT DEFAULT '${defaultTag}',
    p_processor_instance_id  TEXT DEFAULT '${unknownTag}'
  ) RETURNS INT AS $fn$
  DECLARE
    current_position TEXT;
    v_position_bigint BIGINT;
  BEGIN
    IF p_position IS NOT NULL THEN
        v_position_bigint := CASE
          WHEN p_position LIKE '%:%' THEN split_part(p_position, ':', 2)::BIGINT
          ELSE p_position::BIGINT
        END;
    END IF;

    IF p_check_position IS NOT NULL THEN
        UPDATE "${processorsTable.name}"
        SET
          "last_processed_checkpoint" = p_position,
          "last_processed_transaction_id" = p_transaction_id,
          "last_updated" = now()
        WHERE "processor_id" = p_processor_id
          AND "last_processed_checkpoint" = p_check_position
          AND "partition" = p_partition
          AND "version" = p_version;

        IF FOUND THEN
            UPDATE "emt_subscriptions"
            SET
              "last_processed_position" = v_position_bigint,
              "last_processed_transaction_id" = p_transaction_id
            WHERE "subscription_id" = p_processor_id
              AND "partition" = p_partition
              AND "version" = p_version;

            IF NOT FOUND THEN
                INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
                VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
                ON CONFLICT DO NOTHING;
            END IF;

            RETURN 1;
        END IF;

        -- TODO: Remove once all deployments have run the 0.43.0 migration.
        -- Handles mixed-format checkpoints during blue-green deployment.
        IF p_check_position LIKE '%:%' THEN
            -- New code, stored value still in old format (plain global position).
            UPDATE "${processorsTable.name}"
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
            -- Old code, stored value already in new format (txid:globalpos).
            UPDATE "${processorsTable.name}"
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
            UPDATE "emt_subscriptions"
            SET
              "last_processed_position" = v_position_bigint,
              "last_processed_transaction_id" = p_transaction_id
            WHERE "subscription_id" = p_processor_id
              AND "partition" = p_partition
              AND "version" = p_version;

            IF NOT FOUND THEN
                INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
                VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
                ON CONFLICT DO NOTHING;
            END IF;

            RETURN 1;
        END IF;

        SELECT "last_processed_checkpoint" INTO current_position
        FROM "${processorsTable.name}"
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
        INSERT INTO "${processorsTable.name}"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
        VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());

        INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
        VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
        ON CONFLICT DO NOTHING;

        RETURN 1;
    EXCEPTION WHEN unique_violation THEN
        SELECT "last_processed_checkpoint" INTO current_position
        FROM "${processorsTable.name}"
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
  $fn$ LANGUAGE plpgsql;
END IF;
END $$;
`;

export const migration_0_42_4_forwardCompatibleCheckpoints: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.42.4:forward-compatible-checkpoints',
    [
      rawSql(noLegacySubscriptionBridgeSQL),
      rawSql(legacySubscriptionBridgeSQL),
    ],
  );
