import {
  dumbo,
  exists,
  functionExists,
  rawSql,
  tableExists,
  type Dumbo,
} from '@event-driven-io/dumbo';
import { assertTrue } from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import assert from 'assert';
import { after, before, describe, it } from 'node:test';
import { createEventStoreSchema } from '../schema';

void describe('createEventStoreSchema', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = dumbo({
      connectionString: postgres.getConnectionUri(),
    });
    await createEventStoreSchema(pool);
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('creates tables', () => {
    void it('creates the streams table', async () => {
      assert.ok(await tableExists(pool, 'emt_streams'));
    });

    void it('creates the events table', async () => {
      assert.ok(await tableExists(pool, 'emt_messages'));
    });

    void it('creates the subscriptions table', async () => {
      assert.ok(await tableExists(pool, 'emt_subscriptions'));
    });

    void it('creates the events default partition', async () => {
      assert.ok(await tableExists(pool, 'emt_messages_emt_default'));
    });

    void it('creates the events secondary level active partition', async () => {
      assert.ok(await tableExists(pool, 'emt_messages_emt_default_active'));
    });

    void it('creates the events secondary level archived partition', async () => {
      assert.ok(await tableExists(pool, 'emt_messages_emt_default_archived'));
    });
  });

  void describe('creates functions', () => {
    void it('creates the append_event function', async () => {
      assert.ok(await functionExists(pool, 'emt_append_event'));
    });

    void it('creates the emt_add_partition function', async () => {
      assert.ok(await functionExists(pool, 'emt_add_partition'));
    });

    void it('creates the add_module function', async () => {
      assert.ok(await functionExists(pool, 'add_module'));
    });

    void it('creates the add_tenant function', async () => {
      assert.ok(await functionExists(pool, 'add_tenant'));
    });

    void it('creates the add_module_for_all_tenants function', async () => {
      assert.ok(await functionExists(pool, 'add_module_for_all_tenants'));
    });

    void it('creates the add_tenant_for_all_modules function', async () => {
      assert.ok(await functionExists(pool, 'add_tenant_for_all_modules'));
    });
  });

  void it('allows adding a module', async () => {
    await pool.execute.query(rawSql(`SELECT add_module('test_module')`));

    const res = await exists(
      pool.execute.query(
        rawSql(`
      SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'emt_messages_test_module__global'
      ) AS exists;
    `),
      ),
    );

    assertTrue(res, 'Module partition was not created');
  });

  void it('should allow adding a tenant', async () => {
    await pool.execute.query(
      rawSql(`SELECT add_tenant('test_module', 'test_tenant')`),
    );

    const res = await exists(
      pool.execute.query(
        rawSql(`
          SELECT EXISTS (
            SELECT FROM pg_tables
            WHERE tablename = 'emt_messages_test_module__test_tenant'
          ) AS exists;`),
      ),
    );

    assertTrue(res, 'Tenant partition was not created');
  });

  // void it('should allow adding a module for all tenants', async () => {
  //   await createEventStoreSchema(pool);

  //   await pool.query(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id)
  //                     VALUES ('test_stream', 0, 'global__global', '{}', '{}', '1.0', 'test', '${uuid()}', pg_current_xact_id())`);

  //   await pool.query(`SELECT add_module_for_all_tenants('new_module')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_messages_new_module__existing_tenant'
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

  //   await pool.query(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id)
  //                     VALUES ('test_stream', 0, '${emmettPrefix}:partition:existing_module:existing_tenant', '{}', '{}', '1.0', 'test', '${uuid()}', 0)`);

  //   await pool.query(`SELECT add_tenant_for_all_modules('new_tenant')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_messages_existing_module_new_tenant'
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
