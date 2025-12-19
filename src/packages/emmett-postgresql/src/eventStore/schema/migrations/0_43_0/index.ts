import { rawSql } from '@event-driven-io/dumbo';
import { defaultTag } from '../../typing';

export const migration_0_43_0_cleanupLegacySubscriptionSQL = rawSql(`
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
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
      p_partition              TEXT DEFAULT '${defaultTag}',
      p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
    ) RETURNS INT AS $fn$
    DECLARE
      current_position TEXT;
    BEGIN
      IF p_check_position IS NOT NULL THEN
          UPDATE "emt_processors"
          SET
            "last_processed_checkpoint" = p_position,
            "last_processed_transaction_id" = p_transaction_id
          WHERE "processor_id" = p_processor_id AND "last_processed_checkpoint" = p_check_position AND "partition" = p_partition;

          IF FOUND THEN
              RETURN 1;
          END IF;

          SELECT "last_processed_checkpoint" INTO current_position
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

          IF current_position = p_position THEN
              RETURN 0;
          ELSIF current_position > p_check_position THEN
              RETURN 2;
          ELSE
              RETURN 2;
          END IF;
      END IF;

      BEGIN
          INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id")
          VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id);
          RETURN 1;
      EXCEPTION WHEN unique_violation THEN
          SELECT "last_processed_checkpoint" INTO current_position
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

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
`);
