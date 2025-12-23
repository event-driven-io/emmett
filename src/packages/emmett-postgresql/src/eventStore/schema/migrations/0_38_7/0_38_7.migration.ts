import {
  SQL,
  type SQLMigration,
  rawSql,
  sqlMigration,
} from '@event-driven-io/dumbo';

export const dropFutureConceptModuleAndTenantFunctions = SQL`
  DO $$
  BEGIN
      -- Check and drop functions related to future concept of modules and tenants
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_module') THEN
          DROP FUNCTION add_module(TEXT);
      END IF;
      
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_tenant') THEN
          DROP FUNCTION add_tenant(TEXT, TEXT);
      END IF;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_module_for_all_tenants') THEN
          DROP FUNCTION add_module_for_all_tenants(TEXT);
      END IF;
  
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_tenant_for_all_modules') THEN
          DROP FUNCTION add_tenant_for_all_modules(TEXT);
      END IF;
  END $$;
`;

export const dropOldAppendToSQLWithoutGlobalPositions = SQL`
  DO $$
  DECLARE
      v_current_return_type text;
  BEGIN
      -- Get the current return type definition as text
      SELECT pg_get_function_result(p.oid)
      INTO v_current_return_type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = current_schema()  -- or specify your schema
      AND p.proname = 'emt_append_to_stream'
      AND p.pronargs = 10;  -- number of arguments
      
      -- Check if it contains the old column name
      IF v_current_return_type IS NOT NULL AND 
        v_current_return_type LIKE '%last_global_position%' AND 
        v_current_return_type NOT LIKE '%global_positions%' THEN
          DROP FUNCTION emt_append_to_stream(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text);
          RAISE NOTICE 'Old version of function dropped. Return type was: %', v_current_return_type;
      END IF;
  END $$;
`;

export const migrationFromEventsToMessagesSQL = rawSql(`
DO $$ 
DECLARE
    partition_record RECORD;
BEGIN
    -- Rename the main table and its columns if it exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_events') THEN
        -- Rename all partitions first
        FOR partition_record IN 
            SELECT tablename 
            FROM pg_tables 
            WHERE tablename LIKE 'emt_events_%'
            ORDER BY tablename DESC  -- to handle child partitions first
        LOOP
            EXECUTE format('ALTER TABLE %I RENAME TO %I', 
                partition_record.tablename, 
                REPLACE(partition_record.tablename, 'events', 'messages'));
        END LOOP;

        -- Rename the main table
        ALTER TABLE emt_events RENAME TO emt_messages;
        
        -- Rename columns
        ALTER TABLE emt_messages 
            RENAME COLUMN event_data TO message_data;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_metadata TO message_metadata;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_schema_version TO message_schema_version;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_type TO message_type;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_id TO message_id;
        ALTER TABLE emt_messages 
            ADD COLUMN message_kind CHAR(1) NOT NULL DEFAULT 'E';

        -- Rename sequence if it exists
        IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'emt_global_event_position') THEN
            ALTER SEQUENCE emt_global_event_position 
            RENAME TO emt_global_message_position;
            
            ALTER TABLE emt_messages 
                ALTER COLUMN global_position 
                SET DEFAULT nextval('emt_global_message_position');
        END IF;
    END IF;
END $$;`);

export const migration_0_38_7_and_older: SQLMigration = sqlMigration(
  'emt:postgresql:eventstore:0.38.7:migrate-events-to-messages',
  [
    dropFutureConceptModuleAndTenantFunctions,
    dropOldAppendToSQLWithoutGlobalPositions,
    migrationFromEventsToMessagesSQL,
  ],
);
