import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Event,
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
} from '@event-driven-io/emmett';
import {
  getOpossumEventStore,
  type OpossumEventStore,
} from './opossumEventStore';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number }
>;

type ProductItemRemoved = Event<
  'ProductItemRemoved',
  { productId: string; quantity: number }
>;

type ShoppingCartEvent = ProductItemAdded | ProductItemRemoved;

type ShoppingCartState = {
  productItems: Map<string, number>;
};

const evolve = (
  state: ShoppingCartState,
  event: ShoppingCartEvent,
): ShoppingCartState => {
  const { productItems } = state;

  switch (event.type) {
    case 'ProductItemAdded': {
      const current = productItems.get(event.data.productId) ?? 0;
      productItems.set(event.data.productId, current + event.data.quantity);
      return { productItems };
    }
    case 'ProductItemRemoved': {
      const current = productItems.get(event.data.productId) ?? 0;
      productItems.set(
        event.data.productId,
        Math.max(0, current - event.data.quantity),
      );
      return { productItems };
    }
  }
};

const initialState = (): ShoppingCartState => ({
  productItems: new Map(),
});

describe('OpossumEventStore', () => {
  let store: OpossumEventStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opossum-test-'));
    store = await getOpossumEventStore({
      storeName: `test-${randomUUID()}`,
      rootPath: tempDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('appendToStream and readStream', () => {
    it('appends events and reads them back', async () => {
      const streamName = `cart-${randomUUID()}`;

      const result = await store.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 2 } },
          { type: 'ProductItemAdded', data: { productId: 'p2', quantity: 1 } },
        ],
      );

      expect(result.nextExpectedStreamVersion).toBe(2n);
      expect(result.createdNewStream).toBe(true);

      const readResult = await store.readStream(streamName);

      expect(readResult.events).toHaveLength(2);
      expect(readResult.currentStreamVersion).toBe(2n);
      expect(readResult.streamExists).toBe(true);

      expect(readResult.events[0]!.type).toBe('ProductItemAdded');
      expect(readResult.events[0]!.data).toEqual({
        productId: 'p1',
        quantity: 2,
      });
      expect(readResult.events[0]!.metadata.streamName).toBe(streamName);
      expect(readResult.events[0]!.metadata.streamPosition).toBe(1n);

      expect(readResult.events[1]!.type).toBe('ProductItemAdded');
      expect(readResult.events[1]!.data).toEqual({
        productId: 'p2',
        quantity: 1,
      });
      expect(readResult.events[1]!.metadata.streamPosition).toBe(2n);
    });

    it('reads empty stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      const readResult = await store.readStream(streamName);

      expect(readResult.events).toHaveLength(0);
      expect(readResult.currentStreamVersion).toBe(0n);
      expect(readResult.streamExists).toBe(false);
    });

    it('appends to existing stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 2 } },
      ]);

      const result = await store.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          {
            type: 'ProductItemRemoved',
            data: { productId: 'p1', quantity: 1 },
          },
        ],
      );

      expect(result.nextExpectedStreamVersion).toBe(2n);
      expect(result.createdNewStream).toBe(false);

      const readResult = await store.readStream(streamName);
      expect(readResult.events).toHaveLength(2);
    });

    it('reads with from/to options', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
        { type: 'ProductItemAdded', data: { productId: 'p2', quantity: 2 } },
        { type: 'ProductItemAdded', data: { productId: 'p3', quantity: 3 } },
      ]);

      const readResult = await store.readStream(streamName, {
        from: 1n,
        to: 2n,
      });

      expect(readResult.events).toHaveLength(1);
      expect(readResult.events[0]!.data.productId).toBe('p2');
    });

    it('reads with maxCount option', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
        { type: 'ProductItemAdded', data: { productId: 'p2', quantity: 2 } },
        { type: 'ProductItemAdded', data: { productId: 'p3', quantity: 3 } },
      ]);

      const readResult = await store.readStream(streamName, {
        maxCount: 2n,
      });

      expect(readResult.events).toHaveLength(2);
    });
  });

  describe('streamExists', () => {
    it('returns false for non-existent stream', async () => {
      const exists = await store.streamExists(`cart-${randomUUID()}`);
      expect(exists).toBe(false);
    });

    it('returns true for existing stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
      ]);

      const exists = await store.streamExists(streamName);
      expect(exists).toBe(true);
    });
  });

  describe('aggregateStream', () => {
    it('aggregates events into state', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 3 } },
        { type: 'ProductItemAdded', data: { productId: 'p2', quantity: 1 } },
        {
          type: 'ProductItemRemoved',
          data: { productId: 'p1', quantity: 1 },
        },
      ]);

      const result = await store.aggregateStream<
        ShoppingCartState,
        ShoppingCartEvent
      >(streamName, {
        evolve,
        initialState,
      });

      expect(result.currentStreamVersion).toBe(3n);
      expect(result.streamExists).toBe(true);
      expect(result.state.productItems.get('p1')).toBe(2);
      expect(result.state.productItems.get('p2')).toBe(1);
    });

    it('returns initial state for non-existent stream', async () => {
      const result = await store.aggregateStream<
        ShoppingCartState,
        ShoppingCartEvent
      >(`cart-${randomUUID()}`, {
        evolve,
        initialState,
      });

      expect(result.currentStreamVersion).toBe(0n);
      expect(result.streamExists).toBe(false);
      expect(result.state.productItems.size).toBe(0);
    });
  });

  describe('expected version', () => {
    it('succeeds with correct expected version', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
      ]);

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p2', quantity: 1 },
            },
          ],
          { expectedStreamVersion: 1n },
        ),
      ).resolves.toBeDefined();
    });

    it('throws on wrong expected version', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
      ]);

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p2', quantity: 1 },
            },
          ],
          { expectedStreamVersion: 5n },
        ),
      ).rejects.toThrow(ExpectedVersionConflictError);
    });

    it('succeeds with STREAM_DOES_NOT_EXIST for new stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p1', quantity: 1 },
            },
          ],
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        ),
      ).resolves.toBeDefined();
    });

    it('throws with STREAM_DOES_NOT_EXIST for existing stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
      ]);

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p2', quantity: 1 },
            },
          ],
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        ),
      ).rejects.toThrow(ExpectedVersionConflictError);
    });

    it('succeeds with STREAM_EXISTS for existing stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
      ]);

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p2', quantity: 1 },
            },
          ],
          { expectedStreamVersion: STREAM_EXISTS },
        ),
      ).resolves.toBeDefined();
    });

    it('throws with STREAM_EXISTS for non-existent stream', async () => {
      const streamName = `cart-${randomUUID()}`;

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p1', quantity: 1 },
            },
          ],
          { expectedStreamVersion: STREAM_EXISTS },
        ),
      ).rejects.toThrow(ExpectedVersionConflictError);
    });

    it('succeeds with NO_CONCURRENCY_CHECK', async () => {
      const streamName = `cart-${randomUUID()}`;

      await expect(
        store.appendToStream<ShoppingCartEvent>(
          streamName,
          [
            {
              type: 'ProductItemAdded',
              data: { productId: 'p1', quantity: 1 },
            },
          ],
          { expectedStreamVersion: NO_CONCURRENCY_CHECK },
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('stream isolation', () => {
    it('keeps events in separate streams isolated', async () => {
      const stream1 = `cart-${randomUUID()}`;
      const stream2 = `cart-${randomUUID()}`;

      await store.appendToStream<ShoppingCartEvent>(stream1, [
        { type: 'ProductItemAdded', data: { productId: 'p1', quantity: 1 } },
        { type: 'ProductItemAdded', data: { productId: 'p2', quantity: 2 } },
      ]);

      await store.appendToStream<ShoppingCartEvent>(stream2, [
        { type: 'ProductItemAdded', data: { productId: 'p3', quantity: 3 } },
      ]);

      const result1 = await store.readStream(stream1);
      const result2 = await store.readStream(stream2);

      expect(result1.events).toHaveLength(2);
      expect(result2.events).toHaveLength(1);
      expect(result1.currentStreamVersion).toBe(2n);
      expect(result2.currentStreamVersion).toBe(1n);
    });
  });
});
