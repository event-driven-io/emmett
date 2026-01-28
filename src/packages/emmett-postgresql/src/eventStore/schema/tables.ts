import { SQL } from '@event-driven-io/dumbo';
import {
  defaultTag,
  globalTag,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  unknownTag,
} from './typing';

import { createFunctionIfDoesNotExistSQL } from './createFunctionIfDoesNotExist';
import { cleanupLegacySubscriptionTables } from './migrations/0_43_0';
export { cleanupLegacySubscriptionTables };

export const streamsTableSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(streamsTable.name)}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT '${defaultTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, partition, is_archived)
  ) PARTITION BY LIST (partition);
   
  CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_unique 
  ON ${SQL.identifier(streamsTable.name)}(stream_id, partition, is_archived) 
  INCLUDE (stream_position);`;

export const messagesTableSQL = SQL`
  CREATE SEQUENCE IF NOT EXISTS emt_global_message_position;

  CREATE TABLE IF NOT EXISTS ${SQL.identifier(messagesTable.name)}(
      stream_position        BIGINT                    NOT NULL,
      global_position        BIGINT                    DEFAULT nextval('emt_global_message_position'),
      transaction_id         XID8                      NOT NULL,
      created                TIMESTAMPTZ               NOT NULL DEFAULT now(),
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      message_kind           VARCHAR(1)                NOT NULL DEFAULT 'E',
      stream_id              TEXT                      NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT ${SQL.plain(defaultTag)},
      message_schema_version TEXT                      NOT NULL,
      message_id             TEXT                      NOT NULL,
      message_type           TEXT                      NOT NULL,
      message_data           JSONB                     NOT NULL,
      message_metadata       JSONB                     NOT NULL,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ) PARTITION BY LIST (partition);`;

export const processorsTableSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(processorsTable.name)}(
      last_processed_transaction_id XID8                   NOT NULL,
      version                       INT                    NOT NULL DEFAULT 1,
      processor_id                  TEXT                   NOT NULL,
      partition                     TEXT                   NOT NULL DEFAULT ${SQL.plain(defaultTag)},
      status                        TEXT                   NOT NULL DEFAULT 'stopped',
      last_processed_checkpoint     TEXT                   NOT NULL,
      processor_instance_id         TEXT                   DEFAULT ${SQL.plain(unknownTag)},
      created_at                    TIMESTAMPTZ            NOT NULL DEFAULT now(),
      last_updated                  TIMESTAMPTZ            NOT NULL DEFAULT now(),
      PRIMARY KEY (processor_id, partition, version)
  ) PARTITION BY LIST (partition);
`;

export const projectionsTableSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(projectionsTable.name)}(
      version                       INT                    NOT NULL DEFAULT 1,
      type                          VARCHAR(1)             NOT NULL,
      name                          TEXT                   NOT NULL,
      partition                     TEXT                   NOT NULL DEFAULT ${SQL.plain(defaultTag)},
      kind                          TEXT                   NOT NULL,
      status                        TEXT                   NOT NULL,
      definition                    JSONB                  NOT NULL DEFAULT '{}'::jsonb,
      created_at                    TIMESTAMPTZ            NOT NULL DEFAULT now(),
      last_updated                  TIMESTAMPTZ            NOT NULL DEFAULT now(),
      PRIMARY KEY (name, partition, version)
  ) PARTITION BY LIST (partition);
`;

export const sanitizeNameSQL = createFunctionIfDoesNotExistSQL(
  'emt_sanitize_name',
  SQL`CREATE OR REPLACE FUNCTION emt_sanitize_name(input_name TEXT) RETURNS TEXT AS $emt_sanitize_name$
    BEGIN
        RETURN REGEXP_REPLACE(input_name, '[^a-zA-Z0-9_]', '_', 'g');
    END;
    $emt_sanitize_name$ LANGUAGE plpgsql;`,
);

export const addTablePartitions = createFunctionIfDoesNotExistSQL(
  'emt_add_table_partition',
  SQL`
  CREATE OR REPLACE FUNCTION emt_add_table_partition(tableName TEXT, partition_name TEXT) RETURNS void AS $emt_add_table_partition$
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
  $emt_add_table_partition$ LANGUAGE plpgsql;`,
);

export const addPartitionSQL = createFunctionIfDoesNotExistSQL(
  'emt_add_partition',
  SQL`
  CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $emt_add_partition$
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
  $emt_add_partition$ LANGUAGE plpgsql;`,
);

export const addModuleSQL = SQL`
      CREATE OR REPLACE FUNCTION add_module(new_module TEXT) RETURNS void AS $$
      BEGIN
          -- For ${SQL.plain(messagesTable.name)} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
              FOR VALUES IN (emt_sanitize_name(%L || ''__'' || %L)) PARTITION BY LIST (is_archived);',
              emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}'), '${SQL.plain(messagesTable.name)}', new_module, '${SQL.plain(globalTag)}'
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
              FOR VALUES IN (FALSE);',
              emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}' || '_active'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}')
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
              FOR VALUES IN (TRUE);',
              emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}' || '_archived'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}')
          );
  
          -- For ${SQL.plain(streamsTable.name)} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
              FOR VALUES IN (emt_sanitize_name(%L || ''__'' || %L)) PARTITION BY LIST (is_archived);',
              emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}'), '${SQL.plain(streamsTable.name)}', new_module, '${SQL.plain(globalTag)}'
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
              FOR VALUES IN (FALSE);',
              emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}' || '_active'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}')
          );
  
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
              FOR VALUES IN (TRUE);',
              emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}' || '_archived'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || '${SQL.plain(globalTag)}')
          );
      END;
      $$ LANGUAGE plpgsql;
    `;

export const addTenantSQL = SQL`
    CREATE OR REPLACE FUNCTION add_tenant(new_module TEXT, new_tenant TEXT) RETURNS void AS $$
    BEGIN
        -- For ${SQL.plain(messagesTable.name)} table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
            emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || new_tenant), '${SQL.plain(messagesTable.name)}', new_module, new_tenant
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
            FOR VALUES IN (FALSE);',
            emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || new_tenant || '_active'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || new_tenant)
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
            FOR VALUES IN (TRUE);',
            emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || new_tenant || '_archived'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || new_tenant)
        );
  
        -- For ${SQL.plain(streamsTable.name)} table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
            FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
            emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || new_tenant), '${SQL.plain(streamsTable.name)}', new_module, new_tenant
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
            FOR VALUES IN (FALSE);',
            emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || new_tenant || '_active'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || new_tenant)
        );
  
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
            FOR VALUES IN (TRUE);',
            emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || new_tenant || '_archived'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || new_tenant)
        );
    END;
    $$ LANGUAGE plpgsql;
  `;

export const addModuleForAllTenantsSQL = SQL`
    CREATE OR REPLACE FUNCTION add_module_for_all_tenants(new_module TEXT) RETURNS void AS $$
    DECLARE
        tenant_record RECORD;
    BEGIN
        PERFORM add_module(new_module);
  
        FOR tenant_record IN SELECT DISTINCT tenant FROM ${SQL.plain(messagesTable.name)}
        LOOP
            -- For ${SQL.plain(messagesTable.name)} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || tenant_record.tenant), '${SQL.plain(messagesTable.name)}', new_module, tenant_record.tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || tenant_record.tenant || '_active'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || tenant_record.tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || tenant_record.tenant || '_archived'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || new_module || '__' || tenant_record.tenant)
            );
  
            -- For ${SQL.plain(streamsTable.name)} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || tenant_record.tenant), '${SQL.plain(streamsTable.name)}', new_module, tenant_record.tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || tenant_record.tenant || '_active'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || tenant_record.tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || tenant_record.tenant || '_archived'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || new_module || '__' || tenant_record.tenant)
            );
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `;

export const addTenantForAllModulesSQL = SQL`
    CREATE OR REPLACE FUNCTION add_tenant_for_all_modules(new_tenant TEXT) RETURNS void AS $$
    DECLARE
        module_record RECORD;
    BEGIN
        FOR module_record IN SELECT DISTINCT partitionname FROM pg_partman.part_config WHERE parent_table = '${SQL.plain(messagesTable.name)}'
        LOOP
            -- For ${SQL.plain(messagesTable.name)} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || module_record.partitionname || '__' || new_tenant), '${SQL.plain(messagesTable.name)}', module_record.partitionname, new_tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || module_record.partitionname || '__' || new_tenant || '_active'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || module_record.partitionname || '__' || new_tenant || '_archived'), emt_sanitize_name('${SQL.plain(messagesTable.name)}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            -- For ${SQL.plain(streamsTable.name)} table
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (emt_sanitize_name(''%s__%s'')) PARTITION BY LIST (is_archived);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || module_record.partitionname || '__' || new_tenant), '${SQL.plain(streamsTable.name)}', module_record.partitionname, new_tenant
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_active PARTITION OF %I
                FOR VALUES IN (FALSE);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || module_record.partitionname || '__' || new_tenant || '_active'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || module_record.partitionname || '__' || new_tenant)
            );
  
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I_archived PARTITION OF %I
                FOR VALUES IN (TRUE);',
                emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || module_record.partitionname || '__' || new_tenant || '_archived'), emt_sanitize_name('${SQL.plain(streamsTable.name)}_' || module_record.partitionname || '__' || new_tenant)
            );
        END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `;

export const addDefaultPartitionSQL = SQL`SELECT emt_add_partition('${SQL.plain(defaultTag)}');`;
