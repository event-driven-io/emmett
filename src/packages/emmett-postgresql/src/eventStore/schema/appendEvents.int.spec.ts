// tests/appendEvent.test.ts
import { type Event } from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import assert from 'assert';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { appendEvent, createEventStoreSchema } from '../schema';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
export type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('appendEvent', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: pg.Pool;

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

  const events: ShoppingCartEvent[] = [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: '1', quantity: 2, price: 30 } },
      metadata: { meta: 'data1' },
    },
    {
      type: 'DiscountApplied',
      data: { percent: 10 },
      metadata: { meta: 'data2' },
    },
  ];

  void it('should append events correctly using appendEvent function', async () => {
    const result = await appendEvent(pool, 'stream1', 'typeA', events, {
      expectedStreamVersion: 0n,
    });

    assert.strictEqual(result.rows[0]!.success, true);
    assert.strictEqual(result.rows[0]!.next_stream_position, 2n);
    assert(result.rows[0]!.last_global_position > 0);
    assert(result.rows[0]!.transaction_id);
  });

  void it('should append events correctly without expected stream position', async () => {
    const result = await appendEvent(pool, 'stream2', 'typeA', events, {});

    assert.strictEqual(result.rows[0]!.success, true);
    assert.strictEqual(result.rows[0]!.next_stream_position, 2n);
    assert(result.rows[0]!.last_global_position > 0);
    assert(result.rows[0]!.transaction_id);
  });

  void it('should handle stream position conflict correctly when version mismatches', async () => {
    await appendEvent(pool, 'stream3', 'typeA', events, {
      expectedStreamVersion: 0n,
    });

    try {
      await appendEvent(pool, 'stream3', 'typeA', events, {
        expectedStreamVersion: 0n,
      });
      assert.fail('Expected stream position conflict error');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      assert.strictEqual((err as any).message, 'Stream position conflict');
    }
  });

  void it('should handle creating a new stream correctly', async () => {
    const result = await appendEvent(pool, 'stream4', 'typeA', events, {
      expectedStreamVersion: 0n,
    });

    assert.strictEqual(result.rows[0]!.success, true);
    assert.strictEqual(result.rows[0]!.next_stream_position, 2n);
    assert(result.rows[0]!.last_global_position > 0);
    assert(result.rows[0]!.transaction_id);
  });

  void it('should handle appending to an existing stream correctly', async () => {
    await appendEvent(pool, 'stream5', 'typeA', events, {
      expectedStreamVersion: 0n,
    });

    const additionalEvents: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '2', quantity: 1, price: 20 } },
        metadata: { meta: 'data3' },
      },
      {
        type: 'DiscountApplied',
        data: { percent: 5 },
        metadata: { meta: 'data4' },
      },
    ];

    const result = await appendEvent(
      pool,
      'stream5',
      'typeA',
      additionalEvents,
      {
        expectedStreamVersion: 2n,
      },
    );

    assert.strictEqual(result.rows[0]!.success, true);
    assert.strictEqual(result.rows[0]!.next_stream_position, 4n);
    assert(result.rows[0]!.last_global_position > 0);
    assert(result.rows[0]!.transaction_id);
  });

  void it('should handle concurrent appends to a new stream correctly', async () => {
    const eventsConcurrent1: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '3', quantity: 1, price: 50 } },
        metadata: { meta: 'data5' },
      },
    ];

    const eventsConcurrent2: ShoppingCartEvent[] = [
      {
        type: 'DiscountApplied',
        data: { percent: 20 },
        metadata: { meta: 'data6' },
      },
    ];

    await Promise.all([
      appendEvent(pool, 'stream6', 'typeA', eventsConcurrent1, {
        expectedStreamVersion: 0n,
      }),
      appendEvent(pool, 'stream6', 'typeA', eventsConcurrent2, {
        expectedStreamVersion: 1n,
      }),
    ]);

    const res = await pool.query(
      `SELECT * FROM emt_events WHERE stream_id = 'stream6' ORDER BY stream_position`,
    );

    assert.strictEqual(res.rows.length, 2);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.strictEqual(res.rows[0]!.event_id, 'ProductItemAdded');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    assert.strictEqual(res.rows[1]!.event_id, 'DiscountApplied');
  });

  void it('should handle concurrent appends to an existing stream correctly', async () => {
    await appendEvent(pool, 'stream7', 'typeA', events, {
      expectedStreamVersion: 0n,
    });

    const eventsConcurrent1: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '4', quantity: 1, price: 50 } },
        metadata: { meta: 'data5' },
      },
    ];

    const eventsConcurrent2: ShoppingCartEvent[] = [
      {
        type: 'DiscountApplied',
        data: { percent: 25 },
        metadata: { meta: 'data6' },
      },
    ];

    await Promise.all([
      appendEvent(pool, 'stream7', 'typeA', eventsConcurrent1, {
        expectedStreamVersion: 2n,
      }),
      appendEvent(pool, 'stream7', 'typeA', eventsConcurrent2, {
        expectedStreamVersion: 2n,
      }),
    ]);

    const res = await pool.query(
      `SELECT * FROM emt_events WHERE stream_id = 'stream7' ORDER BY stream_position`,
    );

    assert.strictEqual(res.rows.length, 4);
  });

  void it('should handle multiple tenants and modules correctly', async () => {
    const eventsTenant1: ShoppingCartEvent[] = [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '4', quantity: 3, price: 40 } },
        metadata: { meta: 'data7' },
      },
    ];

    const eventsTenant2: ShoppingCartEvent[] = [
      {
        type: 'DiscountApplied',
        data: { percent: 15 },
        metadata: { meta: 'data8' },
      },
    ];

    await appendEvent(pool, 'stream8', 'typeA', eventsTenant1, {
      module: 'moduleA',
      tenant: 'tenant1',
    });
    await appendEvent(pool, 'stream8', 'typeA', eventsTenant2, {
      module: 'moduleB',
      tenant: 'tenant2',
    });

    const res1 = await pool.query(
      `SELECT * FROM emt_events WHERE tenant = 'tenant1' AND module = 'moduleA'`,
    );
    const res2 = await pool.query(
      `SELECT * FROM emt_events WHERE tenant = 'tenant2' AND module = 'moduleB'`,
    );

    assert.strictEqual(res1.rows.length, 1);
    assert.strictEqual(res2.rows.length, 1);
  });

  void it('should handle appending an empty events array gracefully', async () => {
    const result = await appendEvent(pool, 'stream9', 'typeA', [], {});

    assert.strictEqual(result.rows[0]!.success, true);
    assert.strictEqual(result.rows[0]!.next_stream_position, 0n);
    assert.strictEqual(result.rows[0]!.last_global_position, 0n);
  });
});
