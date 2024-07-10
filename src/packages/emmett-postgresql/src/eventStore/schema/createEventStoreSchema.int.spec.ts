// tests/createEventStoreSchema.test.ts
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import assert from 'assert';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { createEventStoreSchema, globalTag } from '../schema';

let postgres: StartedPostgreSqlContainer;
let pool: pg.Pool;

void describe('createEventStoreSchema', () => {
  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = new pg.Pool({
      connectionString: postgres.getConnectionUri(),
    });
    await createEventStoreSchema(pool);
  });

  after(async () => {
    try {
      await pool.end();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should create the event store schema correctly', async () => {
    const resStreams = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'emt_streams'
      ) AS exists;
    `);

    const resEvents = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'emt_events'
      ) AS exists;
    `);

    const resSubscriptions = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'emt_subscriptions'
      ) AS exists;
    `);

    const resFunctions = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'add_module' 
        OR proname = 'add_tenant' 
        OR proname = 'add_module_for_all_tenants' 
        OR proname = 'add_tenant_for_all_modules' 
        OR proname = 'append_event'
      ) AS exists;
    `);

    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      resStreams.rows[0].exists,
      true,
      'Streams table was not created',
    );
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      resEvents.rows[0].exists,
      true,
      'Events table was not created',
    );
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      resSubscriptions.rows[0].exists,
      true,
      'Subscriptions table was not created',
    );
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      resFunctions.rows[0].exists,
      true,
      'Functions were not created',
    );
  });

  void it('should create the global partitions correctly', async () => {
    const resModulePartition = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'emt_events_${globalTag}__${globalTag}'
      ) AS exists;
    `);

    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      resModulePartition.rows[0].exists,
      true,
      'Default module and tenat partition was not created',
    );
  });

  void it('should allow adding a module', async () => {
    await pool.query(`SELECT add_module('test_module')`);

    const res = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'emt_events_test_module__global'
      ) AS exists;
    `);

    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      res.rows[0].exists,
      true,
      'Module partition was not created',
    );
  });

  void it('should allow adding a tenant', async () => {
    await pool.query(`SELECT add_tenant('test_module', 'test_tenant')`);

    const res = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'emt_events_test_module__test_tenant'
      ) AS exists;
    `);

    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      res.rows[0].exists,
      true,
      'Tenant partition was not created',
    );
  });

  // void it('should allow adding a module for all tenants', async () => {
  //   await createEventStoreSchema(pool);

  //   await pool.query(`INSERT INTO emt_events (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, transaction_id)
  //                     VALUES ('test_stream', 0, 'global__global', '{}', '{}', '1.0', 'test', '${uuid()}', pg_current_xact_id())`);

  //   await pool.query(`SELECT add_module_for_all_tenants('new_module')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_events_new_module__existing_tenant'
  //     ) AS exists;
  //   `);

  //   assert.strictEqual(
  //     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  //     res.rows[0].exists,
  //     true,
  //     'Module for all tenants was not created',
  //   );
  // });

  // void it('should allow adding a tenant for all modules', async () => {
  //   await createEventStoreSchema(pool);

  //   await pool.query(`INSERT INTO emt_events (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, transaction_id)
  //                     VALUES ('test_stream', 0, '${emmettPrefix}:partition:existing_module:existing_tenant', '{}', '{}', '1.0', 'test', '${uuid()}', 0)`);

  //   await pool.query(`SELECT add_tenant_for_all_modules('new_tenant')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_events_existing_module_new_tenant'
  //     ) AS exists;
  //   `);

  //   assert.strictEqual(
  //     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  //     res.rows[0].exists,
  //     true,
  //     'Tenant for all modules was not created',
  //   );
  // });
});
