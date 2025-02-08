import { rawSql } from '@event-driven-io/dumbo';
import {
  defaultTag,
  globalTag,
  messagesTable,
  streamsTable,
  subscriptionsTable,
} from './typing';

export const streamsTableSQL = rawSql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  ) PARTITION BY LIST (partition);`,
);

export const messagesTableSQL = rawSql(
  `
  CREATE SEQUENCE IF NOT EXISTS emt_global_event_position;

  CREATE TABLE IF NOT EXISTS ${messagesTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}',
      message_kind           TEXT                      NOT NULL DEFAULT 'Event',
      message_data           JSONB                     NOT NULL,
      message_metadata       JSONB                     NOT NULL,
      message_schema_version TEXT                      NOT NULL,
      message_type           TEXT                      NOT NULL,
      message_id             TEXT                      NOT NULL,
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      global_position        BIGINT                    DEFAULT nextval('emt_global_event_position'),
      transaction_id         XID8                      NOT NULL,
      created                TIMESTAMPTZ               NOT NULL DEFAULT now(),
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ) PARTITION BY LIST (partition);`,
);

export const subscriptionsTableSQL = rawSql(
  `
  CREATE TABLE IF NOT EXISTS ${subscriptionsTable.name}(
      subscription_id                 TEXT                   NOT NULL,
      version                         INT                    NOT NULL DEFAULT 1,
      partition                       TEXT                   NOT NULL DEFAULT '${globalTag}',
      last_processed_position         BIGINT                 NOT NULL,
      last_processed_transaction_id   XID8                   NOT NULL,
      PRIMARY KEY (subscription_id, partition, version)
  ) PARTITION BY LIST (partition);
`,
);

export const sanitizeNameSQL = rawSql(
  `CREATE OR REPLACE FUNCTION emt_sanitize_name(input_name TEXT) RETURNS TEXT AS $$
    BEGIN
        RETURN REGEXP_REPLACE(input_name, '[^a-zA-Z0-9_]', '_', 'g');
    END;
    $$ LANGUAGE plpgsql;`,
);

export const addTablePartitions = rawSql(
  `
  CREATE OR REPLACE FUNCTION emt_add_table_partition(tableName TEXT, partition_name TEXT) RETURNS void AS $$
  DECLARE
    v_main_partiton_name     TEXT;
    v_active_partiton_name   TEXT;
    v_archived_partiton_name TEXT;
  BEGIN                
      v_main_partiton_name     := emt_sanitize_name(tableName || '_' || partition_name);
      v_active_partiton_name   := emt_sanitize_name(v_main_partiton_name   || '_active');
      v_archived_partiton_name := emt_sanitize_name(v_main_partiton_name   || '_archived');


      -- create default partition
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L) PARTITION BY LIST (is_archived);',
          v_main_partiton_name, tableName, partition_name
      );
  
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (FALSE);',
          v_active_partiton_name, v_main_partiton_name
      );
  
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (TRUE);',
          v_archived_partiton_name, v_main_partiton_name
      );
  END;
  $$ LANGUAGE plpgsql;`,
);

export const addPartitionSQL = rawSql(
  `
  CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $$
  BEGIN                
      PERFORM emt_add_table_partition('${messagesTable.name}', partition_name);
      PERFORM emt_add_table_partition('${streamsTable.name}', partition_name);

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L);',
          emt_sanitize_name('${subscriptionsTable.name}' || '_' || partition_name), '${subscriptionsTable.name}', partition_name
      );
  END;
  $$ LANGUAGE plpgsql;`,
);

export const addModuleSQL = rawSql(
  `
      CREATE OR REPLACE FUNCTION add_module(new_module TEXT) RETURNS void AS $$
      BEGIN
          -- For ${messagesTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
              FOR VALUES IN (emt_sanitize_name(%L || ''__'' || %L)) PARTITION BY LIST (is_archived);',
              emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || '${globalTag}'), '${messagesTable.name}', new_module, '${globalTag}'
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
              FOR VALUES IN (FALSE);',
              emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || '${globalTag}' || '_active'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || '${globalTag}')
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
              FOR VALUES IN (TRUE);',
              emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || '${globalTag}' || '_archived'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || '${globalTag}')
          );
  
          -- For ${streamsTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
              FOR VALUES IN (emt_sanitize_name(%L || ''__'' || %L)) PARTITION BY LIST (is_archived);',
              emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || '${globalTag}'), '${streamsTable.name}', new_module, '${globalTag}'
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
              FOR VALUES IN (FALSE);',
              emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || '${globalTag}' || '_active'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || '${globalTag}')
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
              FOR VALUES IN (TRUE);',
              emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || '${globalTag}' || '_archived'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || '${globalTag}')
          );
      END;
      $$ LANGUAGE plpgsql;
    `,
);

export const addTenantSQL = rawSql(
  `
    CREATE OR REPLACE FUNCTION add_tenant(new_module TEXT, new_tenant TEXT) RETURNS void AS $$
    BEGIN
        -- For ${messagesTable.name} table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
            emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || new_tenant), '${messagesTable.name}', new_module, new_tenant
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
            FOR VALUES IN (FALSE);',
            emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || new_tenant || '_active'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || new_tenant)
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
            FOR VALUES IN (TRUE);',
            emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || new_tenant || '_archived'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || new_tenant)
        );
  
        -- For ${streamsTable.name} table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
            emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || new_tenant), '${streamsTable.name}', new_module, new_tenant
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
            FOR VALUES IN (FALSE);',
            emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || new_tenant || '_active'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || new_tenant)
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
            FOR VALUES IN (TRUE);',
            emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || new_tenant || '_archived'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || new_tenant)
        );
    END;
    $$ LANGUAGE plpgsql;
  `,
);

export const addModuleForAllTenantsSQL = rawSql(
  `
    CREATE OR REPLACE FUNCTION add_module_for_all_tenants(new_module TEXT) RETURNS void AS $$
    DECLARE
        tenant_record RECORD;
    BEGIN
        PERFORM add_module(new_module);
  
        FOR tenant_record IN SELECT DISTINCT tenant FROM ${messagesTable.name}
        LOOP
            -- For ${messagesTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || tenant_record.tenant), '${messagesTable.name}', new_module, tenant_record.tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || tenant_record.tenant || '_active'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || tenant_record.tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || tenant_record.tenant || '_archived'), emt_sanitize_name('${messagesTable.name}_' || new_module || '__' || tenant_record.tenant)
            );
  
            -- For ${streamsTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || tenant_record.tenant), '${streamsTable.name}', new_module, tenant_record.tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || tenant_record.tenant || '_active'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || tenant_record.tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || tenant_record.tenant || '_archived'), emt_sanitize_name('${streamsTable.name}_' || new_module || '__' || tenant_record.tenant)
            );
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `,
);

export const addTenantForAllModulesSQL = rawSql(
  `
    CREATE OR REPLACE FUNCTION add_tenant_for_all_modules(new_tenant TEXT) RETURNS void AS $$
    DECLARE
        module_record RECORD;
    BEGIN
        FOR module_record IN SELECT DISTINCT partitionname FROM pg_partman.part_config WHERE parent_table = '${messagesTable.name}'
        LOOP
            -- For ${messagesTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${messagesTable.name}_' || module_record.partitionname || '__' || new_tenant), '${messagesTable.name}', module_record.partitionname, new_tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${messagesTable.name}_' || module_record.partitionname || '__' || new_tenant || '_active'), emt_sanitize_name('${messagesTable.name}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${messagesTable.name}_' || module_record.partitionname || '__' || new_tenant || '_archived'), emt_sanitize_name('${messagesTable.name}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            -- For ${streamsTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${streamsTable.name}_' || module_record.partitionname || '__' || new_tenant), '${streamsTable.name}', module_record.partitionname, new_tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${streamsTable.name}_' || module_record.partitionname || '__' || new_tenant || '_active'), emt_sanitize_name('${streamsTable.name}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${streamsTable.name}_' || module_record.partitionname || '__' || new_tenant || '_archived'), emt_sanitize_name('${streamsTable.name}_' || module_record.partitionname || '__' || new_tenant)
            );
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `,
);

export const addDefaultPartitionSQL = rawSql(
  `SELECT emt_add_partition('${defaultTag}');`,
);

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
