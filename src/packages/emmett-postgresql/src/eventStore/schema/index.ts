// schema.ts
import { type Event } from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import {
  executeSQLBatchInTransaction,
  executeSQLInTransaction,
} from '../../execute';
import { rawSQL, sql, type SQL } from '../../sql';

export const emmettPrefix = 'emt';

export const globalTag = 'global';

export const globalNames = {
  module: `${emmettPrefix}:module:${globalTag}`,
  tenant: `${emmettPrefix}:tenant:${globalTag}`,
};

const columns = {
  partition: {
    name: 'partition',
  },
  isArchived: { name: 'is_archived' },
};

const streamsTable = {
  name: `${emmettPrefix}_streams`,
  columns: {
    partition: columns.partition,
    isArchived: columns.isArchived,
  },
};

const eventsTable = {
  name: `${emmettPrefix}_events`,
  columns: {
    partition: columns.partition,
    isArchived: columns.isArchived,
  },
};

const streamsTableSQL = rawSQL(
  `CREATE TABLE IF NOT EXISTS ${streamsTable.name}(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT '${globalTag}__${globalTag}',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ) PARTITION BY LIST (partition);`,
);

const eventsTableSQL = rawSQL(
  `
  CREATE SEQUENCE IF NOT EXISTS emt_global_event_position;

  CREATE TABLE IF NOT EXISTS ${eventsTable.name}(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT '${globalTag}__${globalTag}',
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

const subscriptionsTableSQL = rawSQL(
  `
  CREATE TABLE IF NOT EXISTS emt_subscriptions(
      subscription_id                 TEXT                   NOT NULL PRIMARY KEY,
      version                         INT                    NOT NULL DEFAULT 1,
      module                          TEXT                   NULL,
      tenant                          TEXT                   NULL,
      last_processed_position         BIGINT                 NOT NULL,
      last_processed_transaction_id   BIGINT                 NOT NULL
  );
`,
);

const sanitizeNameSQL = rawSQL(
  `CREATE OR REPLACE FUNCTION emt_sanitize_name(input_name TEXT) RETURNS TEXT AS $$
    BEGIN
        RETURN REGEXP_REPLACE(input_name, '[^a-zA-Z0-9_]', '_', 'g');
    END;
    $$ LANGUAGE plpgsql;`,
);

const addModuleSQL = rawSQL(
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

const addTenantSQL = rawSQL(
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

const addModuleForAllTenantsSQL = rawSQL(
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

const addTenantForAllModulesSQL = rawSQL(
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

const addGlobalModuleAndTenantSQL = rawSQL(
  `SELECT add_module('${globalTag}');`,
);

const appendEventsSQL = rawSQL(
  `CREATE OR REPLACE FUNCTION append_event(
        v_event_ids text[],
        v_events_data jsonb[],
        v_events_metadata jsonb[],
        v_event_schema_versions text[],
        v_event_types text[],
        v_stream_id text,
        v_stream_type text,
        v_expected_stream_position bigint DEFAULT NULL,
        v_partition text DEFAULT emt_sanitize_name('${globalTag}__${globalTag}')
    ) RETURNS TABLE (
        success boolean,
        next_stream_position bigint,
        last_global_position bigint,
        transaction_id xid8
    ) LANGUAGE plpgsql
    AS $$
    DECLARE
        v_next_stream_position bigint;
        v_position bigint;
        v_updated_rows int;
        v_transaction_id xid8;
        v_last_global_position bigint;
        current_stream_position bigint;
    BEGIN
        IF v_expected_stream_position IS NULL THEN
            SELECT COALESCE(max(stream_position), 0) INTO current_stream_position
            FROM ${streamsTable.name}
            WHERE stream_id = v_stream_id AND partition = v_partition;
        ELSE
            current_stream_position := v_expected_stream_position;
        END IF;
  
        v_next_stream_position := current_stream_position + array_upper(v_events_data, 1);
        v_transaction_id := pg_current_xact_id();
  
        WITH ev AS (
            SELECT row_number() OVER () + current_stream_position AS stream_position, 
                  event_data, 
                  event_metadata, 
                  schema_version, 
                  event_id, 
                  event_type
            FROM (
                SELECT *
                FROM unnest(v_event_ids, v_events_data, v_events_metadata, v_event_schema_versions, v_event_types) AS event(event_id, event_data, event_metadata, schema_version, event_type)
            ) AS event
        ),
        all_events_insert AS (
            INSERT INTO ${eventsTable.name}
                (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, transaction_id)
            SELECT v_stream_id, ev.stream_position, v_partition, ev.event_data, ev.event_metadata, ev.schema_version, ev.event_type, ev.event_id, v_transaction_id
            FROM ev
            RETURNING global_position
        )
        SELECT max(global_position) INTO v_last_global_position FROM all_events_insert;
  
        INSERT INTO ${streamsTable.name}
              (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
        SELECT v_stream_id, v_next_stream_position, v_partition, v_stream_type, '{}', FALSE
        WHERE NOT EXISTS (
            SELECT 1 FROM ${streamsTable.name} 
            WHERE stream_id = v_stream_id AND partition = v_partition
        )
        ON CONFLICT (stream_id, partition) DO UPDATE SET 
            stream_position = v_next_stream_position
            WHERE ${streamsTable.name}.stream_position = current_stream_position;
  
        IF v_expected_stream_position IS NOT NULL THEN
            UPDATE ${streamsTable.name}
            SET stream_position = v_next_stream_position
            WHERE stream_id = v_stream_id AND stream_position = current_stream_position AND partition = v_partition;
  
            GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  
            IF v_updated_rows = 0 THEN
                RETURN QUERY SELECT FALSE, NULL, NULL, NULL;
            END IF;
        END IF;
  
        RETURN QUERY SELECT TRUE, v_next_stream_position, v_last_global_position, v_transaction_id;
    END;
    $$;
  `,
);

export const schemaSQL: SQL[] = [
  streamsTableSQL,
  eventsTableSQL,
  subscriptionsTableSQL,
  sanitizeNameSQL,
  addModuleSQL,
  addTenantSQL,
  addModuleForAllTenantsSQL,
  addTenantForAllModulesSQL,
  appendEventsSQL,
  addGlobalModuleAndTenantSQL,
];

export const createEventStoreSchema = (pool: pg.Pool) =>
  executeSQLBatchInTransaction(pool, ...schemaSQL);

type AppendEventResult = {
  success: boolean;
  next_stream_position: bigint;
  last_global_position: bigint;
  transaction_id: string;
};

export const appendEvent = (
  pool: pg.Pool,
  streamId: string,
  streamType: string,
  events: Event[],
  options: {
    expectedStreamVersion?: bigint;
    module?: string;
    tenant?: string;
  },
): Promise<pg.QueryResult<AppendEventResult>> =>
  executeSQLInTransaction<AppendEventResult>(
    pool,
    sql(
      `SELECT * FROM append_event(
                %L::text[],
                %L::jsonb[],
                %L::jsonb[],
                %L::text[],
                %L::text[],
                %L::text,
                %L::text,
                %s::bigint,
                %L::text,
                %L::text
            )`,
      JSON.stringify(events.map(() => uuid())),
      JSON.stringify(events.map((e) => e.data)),
      JSON.stringify(events.map((e) => e.metadata ?? {})),
      JSON.stringify(events.map((_e) => '1')),
      JSON.stringify(events.map((e) => e.type)),
      streamId,
      streamType,
      options?.expectedStreamVersion ?? null,
      options?.module ?? globalNames.module,
      options?.tenant ?? globalNames.tenant,
    ),
  );
