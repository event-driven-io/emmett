import { rawSql } from '@event-driven-io/dumbo';
import {
  defaultTag,
  eventsTable,
  globalTag,
  streamsTable,
  subscriptionsTable,
} from './typing';

export const streamsTableSQL = rawSql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}__${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived),
      UNIQUE (stream_id, partition, is_archived)
  ) PARTITION BY LIST (partition);`,
);

export const eventsTableSQL = rawSql(
  `
  CREATE SEQUENCE IF NOT EXISTS emt_global_event_position;

  CREATE TABLE IF NOT EXISTS ${eventsTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}',
      event_data             JSONB                     NOT NULL,
      event_metadata         JSONB                     NOT NULL,
      event_schema_version   TEXT                      NOT NULL,
      event_type             TEXT                      NOT NULL,
      event_id               TEXT                      NOT NULL,
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
      partition                       TEXT                   NOT NULL DEFAULT '${globalTag}__${globalTag}',
      last_processed_position         BIGINT                 NOT NULL,
      last_processed_transaction_id   XID8                   NOT NULL,
      PRIMARY KEY (subscription_id, version)
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

      -- create default events partition
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L) PARTITION BY LIST (is_archived);',
          v_main_partiton_name, tableName, partition_name
      );

      -- create default streams partition
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

export const addEventsPartitions = rawSql(
  `
  CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $$
  BEGIN                
      PERFORM emt_add_table_partition('${eventsTable.name}', partition_name);
      PERFORM emt_add_table_partition('${streamsTable.name}', partition_name);
  END;
  $$ LANGUAGE plpgsql;`,
);

export const addModuleSQL = rawSql(
  `
      CREATE OR REPLACE FUNCTION add_module(new_module TEXT) RETURNS void AS $$
      BEGIN
          -- For ${eventsTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
              FOR VALUES IN (emt_sanitize_name(%L || ''__'' || %L)) PARTITION BY LIST (is_archived);',
              emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || '${globalTag}'), '${eventsTable.name}', new_module, '${globalTag}'
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
              FOR VALUES IN (FALSE);',
              emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || '${globalTag}' || '_active'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || '${globalTag}')
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
              FOR VALUES IN (TRUE);',
              emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || '${globalTag}' || '_archived'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || '${globalTag}')
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
        -- For ${eventsTable.name} table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
            emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || new_tenant), '${eventsTable.name}', new_module, new_tenant
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
            FOR VALUES IN (FALSE);',
            emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || new_tenant || '_active'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || new_tenant)
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
            FOR VALUES IN (TRUE);',
            emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || new_tenant || '_archived'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || new_tenant)
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
  
        FOR tenant_record IN SELECT DISTINCT tenant FROM ${eventsTable.name}
        LOOP
            -- For ${eventsTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || tenant_record.tenant), '${eventsTable.name}', new_module, tenant_record.tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || tenant_record.tenant || '_active'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || tenant_record.tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || tenant_record.tenant || '_archived'), emt_sanitize_name('${eventsTable.name}_' || new_module || '__' || tenant_record.tenant)
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
        FOR module_record IN SELECT DISTINCT partitionname FROM pg_partman.part_config WHERE parent_table = '${eventsTable.name}'
        LOOP
            -- For ${eventsTable.name} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${eventsTable.name}_' || module_record.partitionname || '__' || new_tenant), '${eventsTable.name}', module_record.partitionname, new_tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${eventsTable.name}_' || module_record.partitionname || '__' || new_tenant || '_active'), emt_sanitize_name('${eventsTable.name}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${eventsTable.name}_' || module_record.partitionname || '__' || new_tenant || '_archived'), emt_sanitize_name('${eventsTable.name}_' || module_record.partitionname || '__' || new_tenant)
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

export const addDefaultPartition = rawSql(
  `SELECT emt_add_partition('${defaultTag}');`,
);
