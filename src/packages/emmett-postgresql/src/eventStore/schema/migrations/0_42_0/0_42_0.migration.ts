import {
  rawSql,
  sqlMigration,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import { defaultTag } from '../../typing';

export const migration_0_42_0_FromSubscriptionsToProcessorsSQL = rawSql(`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
        -- 1. Alter message_kind type from CHAR(1) to VARCHAR(1)
        ALTER TABLE emt_messages ALTER COLUMN message_kind TYPE VARCHAR(1);

        -- 2. Setup emt_processors table if not exists
        CREATE TABLE IF NOT EXISTS "emt_processors"(
              last_processed_transaction_id XID8                   NOT NULL,
              version                       INT                    NOT NULL DEFAULT 1,
              processor_id                  TEXT                   NOT NULL,
              partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
              status                        TEXT                   NOT NULL DEFAULT 'stopped', 
              last_processed_checkpoint     TEXT                   NOT NULL,    
              processor_instance_id         TEXT                   DEFAULT 'emt:unknown',
              PRIMARY KEY (processor_id, partition, version)
          ) PARTITION BY LIST (partition);

        -- 3. Setup emt_projections table if not exists

        CREATE TABLE IF NOT EXISTS "emt_projections"(
            version                       INT                    NOT NULL DEFAULT 1,  
            type                          VARCHAR(1)             NOT NULL,
            name                          TEXT                   NOT NULL,
            partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
            kind                          TEXT                   NOT NULL, 
            status                        TEXT                   NOT NULL, 
            definition                    JSONB                  NOT NULL DEFAULT '{}'::jsonb, 
            PRIMARY KEY (name, partition, version)
        ) PARTITION BY LIST (partition);

        CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $fnpar$
        BEGIN                
            PERFORM emt_add_table_partition('emt_messages', partition_name);
            PERFORM emt_add_table_partition('emt_streams', partition_name);
        
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (%L);',
                emt_sanitize_name('emt_subscriptions' || '_' || partition_name), 'emt_subscriptions', partition_name
            );

            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (%L);',
                emt_sanitize_name('emt_processors' || '_' || partition_name), 'emt_processors', partition_name
            );
        
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (%L);',
                emt_sanitize_name('emt_projections' || '_' || partition_name), 'emt_projections', partition_name
            );
        END;
        $fnpar$ LANGUAGE plpgsql;

        PERFORM emt_add_partition('${defaultTag}');

        -- 3. Copy data from old table to new table
        INSERT INTO "emt_processors"
        (
            processor_id,
            version,
            partition,
            last_processed_checkpoint,
            last_processed_transaction_id,
            status,
            processor_instance_id
        )
        SELECT 
            subscription_id, 
            version,
            partition,
            lpad(last_processed_position::text, 19, '0'),
            last_processed_transaction_id, 'stopped', 
            'emt:unknown'
        FROM emt_subscriptions
        ON CONFLICT DO NOTHING;

        -- 4. Create backward-compat store_subscription_checkpoint that dual-writes
        
        CREATE OR REPLACE FUNCTION store_subscription_checkpoint(
          p_subscription_id VARCHAR(100),
          p_version BIGINT,
          p_position BIGINT,
          p_check_position BIGINT,
          p_transaction_id xid8,
          p_partition TEXT DEFAULT 'emt:default'
        ) RETURNS INT AS $fn$
        DECLARE
          current_position BIGINT;
          result INT;
        BEGIN
          -- Handle the case when p_check_position is provided
          IF p_check_position IS NOT NULL THEN
              -- Try to update if the position matches p_check_position
              UPDATE "emt_subscriptions"
              SET
                "last_processed_position" = p_position,
                "last_processed_transaction_id" = p_transaction_id
              WHERE "subscription_id" = p_subscription_id AND "last_processed_position" = p_check_position AND "partition" = p_partition;

              IF FOUND THEN
                  -- Dual-write to emt_processors
                  UPDATE "emt_processors"
                  SET
                    "last_processed_checkpoint" = lpad(p_position::text, 19, '0'),
                    "last_processed_transaction_id" = p_transaction_id
                  WHERE "processor_id" = p_subscription_id AND "partition" = p_partition;

                  IF NOT FOUND THEN
                      INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "status", "processor_instance_id")
                      VALUES (p_subscription_id, p_version, lpad(p_position::text, 19, '0'), p_partition, p_transaction_id, 'stopped', 'emt:unknown')
                      ON CONFLICT DO NOTHING;
                  END IF;

                  RETURN 1;
              END IF;

              -- Retrieve the current position
              SELECT "last_processed_position" INTO current_position
              FROM "emt_subscriptions"
              WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSIF current_position > p_check_position THEN
                  RETURN 2;
              ELSE
                  RETURN 2;
              END IF;
          END IF;

          -- Handle the case when p_check_position is NULL: Insert if not exists
          BEGIN
              INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
              VALUES (p_subscription_id, p_version, p_position, p_partition, p_transaction_id);

              -- Dual-write to emt_processors
              INSERT INTO emt_processors("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "status", "processor_instance_id")
              VALUES (p_subscription_id, p_version, lpad(p_position::text, 19, '0'), p_partition, p_transaction_id, 'stopped', 'emt:unknown')
              ON CONFLICT DO NOTHING;

              RETURN 1;
          EXCEPTION WHEN unique_violation THEN
              SELECT "last_processed_position" INTO current_position
              FROM "emt_subscriptions"
              WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSE
                  RETURN 2;
              END IF;
          END;
        END;
        $fn$ LANGUAGE plpgsql;

        -- 5. Replace store_processor_checkpoint with dual-write version
        CREATE OR REPLACE FUNCTION store_processor_checkpoint(
          p_processor_id           TEXT,
          p_version                BIGINT,
          p_position               TEXT,
          p_check_position         TEXT,
          p_transaction_id         xid8,
          p_partition              TEXT DEFAULT '${defaultTag}',
          p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
        ) RETURNS INT AS $fn2$
        DECLARE
          current_position TEXT;
          v_position_bigint BIGINT;
        BEGIN
          -- Convert TEXT position to BIGINT for emt_subscriptions
          v_position_bigint := p_position::BIGINT;

          -- Handle the case when p_check_position is provided
          IF p_check_position IS NOT NULL THEN
              -- Try to update if the position matches p_check_position
              UPDATE "emt_processors"
              SET
                "last_processed_checkpoint" = p_position,
                "last_processed_transaction_id" = p_transaction_id
              WHERE "processor_id" = p_processor_id AND "last_processed_checkpoint" = p_check_position AND "partition" = p_partition;

              IF FOUND THEN
                  -- Dual-write to emt_subscriptions
                  UPDATE "emt_subscriptions"
                  SET
                    "last_processed_position" = v_position_bigint,
                    "last_processed_transaction_id" = p_transaction_id
                  WHERE "subscription_id" = p_processor_id AND "partition" = p_partition;

                  IF NOT FOUND THEN
                      INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
                      VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
                      ON CONFLICT DO NOTHING;
                  END IF;

                  RETURN 1;
              END IF;

              -- Retrieve the current position
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

          -- Handle the case when p_check_position is NULL: Insert if not exists
          BEGIN
              INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id")
              VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id);

              -- Dual-write to emt_subscriptions
              INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
              VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
              ON CONFLICT DO NOTHING;

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
        $fn2$ LANGUAGE plpgsql;
    END IF;
END $$;
`);

export const migration_0_42_0_FromSubscriptionsToProcessors: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.42.0:from-subscriptions-to-processors',
    [migration_0_42_0_FromSubscriptionsToProcessorsSQL],
  );
