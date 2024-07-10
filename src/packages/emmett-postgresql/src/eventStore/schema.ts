import pg from 'pg';
import { executeSQLInTransaction } from '../execute';
import { sql, type SQL } from '../sql';

const emmettPrefix = 'emt';

const globalNames = {
  module: `${emmettPrefix}:module:global`,
  tenant: `${emmettPrefix}:tenant:global`,
};

const columns = {
  module: {
    name: 'module',
  },
  tenant: { name: 'module' },
  isArchived: { name: 'is_archived' },
};

const streamsTable = {
  name: `${emmettPrefix}_streams`,
  columns: {
    module: columns.module,
    tenant: columns.tenant,
    isArchived: columns.isArchived,
  },
};

const eventsTable = {
  name: `${emmettPrefix}_events`,
  columns: {
    module: columns.module,
    tenant: columns.tenant,
    isArchived: columns.isArchived,
  },
};

const streamsTableSQL = sql(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      module            TEXT                      NOT NULL DEFAULT '${globalNames.module}',
      tenant            TEXT                      NOT NULL DEFAULT '${globalNames.tenant}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, tenant, module)
  );
  PARTITION BY LIST (module, tenant_id)`,
);

const eventsTableSQL = sql(
  `
  CREATE SEQUENCE emt_global_event_position;

  CREATE TABLE IF NOT EXISTS ${eventsTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      module                 TEXT                      NOT NULL DEFAULT '${globalNames.module}',
      tenant                 TEXT                      NOT NULL DEFAULT '${globalNames.tenant}',
      event_data             JSONB                     NOT NULL,
      event_metadata         JSONB                     NOT NULL,
      event_schema_version   TEXT                      NOT NULL,
      event_type             TEXT                      NOT NULL,
      event_id               TEXT                      NOT NULL,
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      global_position        BIGINT                    DEFAULT nextval('emt_global_event_position') PRIMARY KEY,
      transaction_id         XID8                      NOT NULL,
      created                timestamp with time zone  NOT NULL DEFAULT (now()),
      PRIMARY KEY (stream_id, stream_position, tenant, module)
  ) PARTITION BY LIST (module, tenant_id);
  `,
);

const subscriptionsTableSQL = sql(
  `
  CREATE TABLE IF NOT EXISTS emt_subscriptions(
      subscription_id                 TEXT                   NOT NULL PRIMARY KEY,
      version                         INT                    NOT NULL DEFAULT 1,
      module                          TEXT                   NULL,
      tenant                          TEXT                   NULL,
      last_processed_position         BIGINT                 NOT NULL,
      last_processed_transaction_id   BIGINT                 NOT NULL
  )
`,
);

const addModuleSQL = sql(
  `
  CREATE OR REPLACE FUNCTION add_module(new_module TEXT) RETURNS void AS $$
  BEGIN
      -- For ${eventsTable.name} table
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I PARTITION OF ${eventsTable.name}
          FOR VALUES IN (%L, ''${globalNames.tenant}'')
          PARTITION BY LIST (tenant);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_default_tenant PARTITION OF ${eventsTable.name}_%I
          FOR VALUES IN (''${globalNames.tenant}'')
          PARTITION BY LIST (is_archived);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_default_tenant_active PARTITION OF ${eventsTable.name}_%I_default_tenant
          FOR VALUES IN (FALSE);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_default_tenant_archived PARTITION OF ${eventsTable.name}_%I_default_tenant
          FOR VALUES IN (TRUE);',
          new_module, new_module
      );

      -- For ${streamsTable.name} table
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I PARTITION OF ${streamsTable.name}
          FOR VALUES IN (%L, ''${globalNames.tenant}'')
          PARTITION BY LIST (tenant);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_default_tenant PARTITION OF ${streamsTable.name}_%I
          FOR VALUES IN (''${globalNames.tenant}'')
          PARTITION BY LIST (is_archived);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_default_tenant_active PARTITION OF ${streamsTable.name}_%I_default_tenant
          FOR VALUES IN (FALSE);',
          new_module, new_module
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_default_tenant_archived PARTITION OF ${streamsTable.name}_%I_default_tenant
          FOR VALUES IN (TRUE);',
          new_module, new_module
      );
  END;
  $$ LANGUAGE plpgsql;
`,
);

const addTenantSQL = sql(
  `
  CREATE OR REPLACE FUNCTION add_tenant(new_module TEXT, new_tenant TEXT) RETURNS void AS $$
BEGIN
    -- For ${eventsTable.name} table
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I PARTITION OF ${eventsTable.name}_%I
        FOR VALUES IN (%L)
        PARTITION BY LIST (is_archived);',
        new_module, new_tenant, new_module, new_tenant
    );

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_active PARTITION OF ${eventsTable.name}_%I_%I
        FOR VALUES IN (FALSE);',
        new_module, new_tenant, new_module, new_tenant
    );

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_archived PARTITION OF ${eventsTable.name}_%I_%I
        FOR VALUES IN (TRUE);',
        new_module, new_tenant, new_module, new_tenant
    );

    -- For ${streamsTable.name} table
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I PARTITION OF ${streamsTable.name}_%I
        FOR VALUES IN (%L)
        PARTITION BY LIST (is_archived);',
        new_module, new_tenant, new_module, new_tenant
    );

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_active PARTITION OF ${streamsTable.name}_%I_%I
        FOR VALUES IN (FALSE);',
        new_module, new_tenant, new_module, new_tenant
    );

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_archived PARTITION OF ${streamsTable.name}_%I_%I
        FOR VALUES IN (TRUE);',
        new_module, new_tenant, new_module, new_tenant
    );
END;
$$ LANGUAGE plpgsql;

`,
);

const addModuleForAllTenantsSQL = sql(
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
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I PARTITION OF ${eventsTable.name}_%I
              FOR VALUES IN (%L)
              PARTITION BY LIST (is_archived);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_active PARTITION OF ${eventsTable.name}_%I_%I
              FOR VALUES IN (FALSE);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_archived PARTITION OF ${eventsTable.name}_%I_%I
              FOR VALUES IN (TRUE);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );

          -- For ${streamsTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I PARTITION OF ${streamsTable.name}_%I
              FOR VALUES IN (%L)
              PARTITION BY LIST (is_archived);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_active PARTITION OF ${streamsTable.name}_%I_%I
              FOR VALUES IN (FALSE);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_archived PARTITION OF ${streamsTable.name}_%I_%I
              FOR VALUES IN (TRUE);',
              new_module, tenant_record.tenant, new_module, tenant_record.tenant
          );
      END LOOP;
  END;
  $$ LANGUAGE plpgsql;
  `,
);

const addTenantForAllModulesSQL = sql(
  `
  CREATE OR REPLACE FUNCTION add_tenant_for_all_modules(new_tenant TEXT) RETURNS void AS $$
  DECLARE
      module_record RECORD;
  BEGIN
      FOR module_record IN SELECT DISTINCT partitionname FROM pg_partman.part_config WHERE parent_table = '${eventsTable.name}'
      LOOP
          -- For ${eventsTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I PARTITION OF ${eventsTable.name}_%I
              FOR VALUES IN (%L)
              PARTITION BY LIST (is_archived);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_active PARTITION OF ${eventsTable.name}_%I_%I
              FOR VALUES IN (FALSE);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${eventsTable.name}_%I_%I_archived PARTITION OF ${eventsTable.name}_%I_%I
              FOR VALUES IN (TRUE);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );

          -- For ${streamsTable.name} table
          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I PARTITION OF ${streamsTable.name}_%I
              FOR VALUES IN (%L)
              PARTITION BY LIST (is_archived);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_active PARTITION OF ${streamsTable.name}_%I_%I
              FOR VALUES IN (FALSE);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );

          EXECUTE format('
              CREATE TABLE IF NOT EXISTS ${streamsTable.name}_%I_%I_archived PARTITION OF ${streamsTable.name}_%I_%I
              FOR VALUES IN (TRUE);',
              module_record.partitionname, new_tenant, module_record.partitionname, new_tenant
          );
      END LOOP;
  END;
  $$ LANGUAGE plpgsql;
`,
);

const addGlobalModuleAndTenant = sql(
  `
    -- Default partition for module
  SELECT add_module('${globalNames.tenant}');

  -- Default partition for tenant within the default module
  SELECT add_tenant('${globalNames.tenant}', '${globalNames.module}');
  `,
);

export const schemaSQL: SQL[] = [
  streamsTableSQL,
  eventsTableSQL,
  subscriptionsTableSQL,
  addModuleSQL,
  addTenantSQL,
  addModuleForAllTenantsSQL,
  addTenantForAllModulesSQL,
  addGlobalModuleAndTenant,
];

export const createEventStoreSchema = (pool: pg.Pool) =>
  executeSQLInTransaction(pool, ...schemaSQL);
