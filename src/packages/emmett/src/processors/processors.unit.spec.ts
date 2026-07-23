import { v7 as uuid } from 'uuid';
import { beforeEach, describe, it } from 'vitest';
import { EmmettError } from '../errors';
import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertOk,
  assertRejects,
} from '../testing';
import type { Event, ReadEventMetadata, RecordedMessage } from '../typing';
import { isString } from '../validation';
import {
  bigIntProcessorCheckpoint,
  ProcessorCheckpoint,
  type Checkpointer,
} from './checkpoints';
import {
  MessageProcessor,
  projector,
  reactor,
  wasMessageHandled,
} from './processors';

const numericCompareCheckpoints = (
  a: ProcessorCheckpoint,
  b: ProcessorCheckpoint,
): number => {
  const [left, right] = [BigInt(a), BigInt(b)];
  return left > right ? 1 : left < right ? -1 : 0;
};

type TestEvent = Event<'test', { counter: number }>;

void describe('Processors', () => {
  void describe('reactor', () => {
    void it('should create reactor with default options', () => {
      // Given
      const processorId = uuid();

      // When
      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
      });

      // Then
      assertMatches(processor, {
        id: processorId,
        type: 'reactor',
      });
      assertOk(isString(processor.instanceId));
    });

    void it('should call onStart hook on start', async () => {
      // Given
      const processorId = uuid();
      let onStartCalled = false;

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onStart: () => {
            onStartCalled = true;
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start();

      // Then
      assertEqual(onStartCalled, true);
    });

    void it('should call onClose hook on close', async () => {
      // Given
      const processorId = uuid();
      let onCloseCalled = false;

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onClose: () => {
            onCloseCalled = true;
            return Promise.resolve();
          },
        },
      });

      await processor.start();

      // When
      await processor.close();

      // Then
      assertEqual(onCloseCalled, true);
    });

    void it('should set isActive to false when close is called', async () => {
      // Given
      const processorId = uuid();
      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
      });

      // When
      await processor.start();
      assertEqual(processor.isActive, true);

      await processor.close();

      // Then
      assertEqual(processor.isActive, false);
    });

    // TODO: Fix this when active is aligned in close method
    void it.skip('should be idempotent - calling close multiple times is safe', async () => {
      // Given
      const processorId = uuid();
      let closeCount = 0;

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onClose: () => {
            closeCount++;
            return Promise.resolve();
          },
        },
      });

      await processor.start();

      // When
      await processor.close();
      await processor.close();
      await processor.close();

      // Then
      assertEqual(closeCount, 1);
    });

    void it('should work even without onClose hook', async () => {
      // Given
      const processorId = uuid();
      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
      });

      await processor.start();

      // When/Then - should not throw
      await processor.close();
      assertEqual(processor.isActive, false);
    });

    void it('should automatically close on SIGTERM', async () => {
      // Given
      const processorId = uuid();
      let closeCalled = false;

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onClose: () => {
            closeCalled = true;
            return Promise.resolve();
          },
        },
      });

      await processor.start();
      assertEqual(processor.isActive, true);

      // When - emit SIGTERM
      process.emit('SIGTERM');

      await Promise.resolve();

      // Then
      assertEqual(processor.isActive, false);
      assertEqual(closeCalled, true);
    });

    void it('should automatically close on SIGINT', async () => {
      // Given
      const processorId = uuid();
      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
      });

      await processor.start();
      assertEqual(processor.isActive, true);

      // When
      process.emit('SIGINT');
      await Promise.resolve();

      // Then
      assertEqual(processor.isActive, false);
    });

    void it('should pass startOptions to onClose hook on SIGTERM', async () => {
      // Given
      const processorId = uuid();
      let receivedContext: Record<string, unknown> | undefined;

      const startOptions = {
        connectionString: 'postgresql://localhost:5432/testdb',
      };

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onClose: (context) => {
            receivedContext = context;
            return Promise.resolve();
          },
        },
      });

      await processor.start(startOptions);

      // When - emit SIGTERM
      process.emit('SIGTERM');
      await Promise.resolve();

      // Then - onClose should have received the connection context
      assertOk(receivedContext !== undefined);
      assertEqual(
        receivedContext!.connectionString,
        'postgresql://localhost:5432/testdb',
      );
    });

    void it('should cleanup signal handlers when closed manually', async () => {
      // Given
      const processorId = uuid();
      let closeCount = 0;

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        hooks: {
          onClose: () => {
            closeCount++;
            return Promise.resolve();
          },
        },
      });

      await processor.start();

      // When - close manually
      await processor.close();
      assertEqual(closeCount, 1);
      assertEqual(processor.isActive, false);

      // Then - signal should not trigger another close
      process.emit('SIGTERM');
      await Promise.resolve();
      assertEqual(closeCount, 1);
    });

    [
      { name: 'not defined' },
      { canHandle: undefined, name: 'undefined' },
      { canHandle: ['test'], name: 'array with matching event type' },
      {
        canHandle: ['test', 'some other type'],
        name: 'array with multiple event types including matching',
      },
    ].forEach(({ canHandle, name }) => {
      void it(`should call eachMessage for each message in handle (${name})`, async () => {
        // Given
        const processorId = uuid();
        const handledMessages: RecordedMessage[] = [];

        const processor = reactor({
          processorId,
          canHandle,
          eachMessage: (message) => {
            handledMessages.push(message);
            return Promise.resolve();
          },
        });

        const event1: TestEvent = { type: 'test', data: { counter: 1 } };
        const event2: TestEvent = { type: 'test', data: { counter: 2 } };

        const recordedEvents: RecordedMessage<
          TestEvent,
          ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
        >[] = [
          {
            ...event1,
            kind: 'Event',
            metadata: {
              streamName: 'test-stream',
              messageId: uuid(),
              checkpoint: bigIntProcessorCheckpoint(1n),
              globalPosition: 1n,
              streamPosition: 1n,
            },
          },
          {
            ...event2,
            kind: 'Event',
            metadata: {
              streamName: 'test-stream',
              messageId: uuid(),
              checkpoint: bigIntProcessorCheckpoint(2n),
              globalPosition: 2n,
              streamPosition: 2n,
            },
          },
        ];

        await processor.start();

        // When
        await processor.handle(recordedEvents, {});

        // Then
        assertEqual(handledMessages.length, 2);
        assertDeepEqual(handledMessages, recordedEvents);
      });
    });

    [
      { canHandle: [], name: 'empty array' },
      {
        canHandle: ['some other type'],
        name: 'array with non-matching event type',
      },
      {
        canHandle: ['some other type', 'and another'],
        name: 'array with multiple non-matching event types',
      },
    ].forEach(({ canHandle, name }) => {
      void it(`should NOT call eachMessage for each message in handle (${name})`, async () => {
        // Given
        const processorId = uuid();
        const handledMessages: RecordedMessage[] = [];

        const processor = reactor({
          processorId,
          canHandle,
          eachMessage: (message) => {
            handledMessages.push(message);
            return Promise.resolve();
          },
        });

        const event1: TestEvent = { type: 'test', data: { counter: 1 } };
        const event2: TestEvent = { type: 'test', data: { counter: 2 } };

        const recordedEvents: RecordedMessage<
          TestEvent,
          ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
        >[] = [
          {
            ...event1,
            kind: 'Event',
            metadata: {
              streamName: 'test-stream',
              messageId: uuid(),
              checkpoint: bigIntProcessorCheckpoint(1n),
              globalPosition: 1n,
              streamPosition: 1n,
            },
          },
          {
            ...event2,
            kind: 'Event',
            metadata: {
              streamName: 'test-stream',
              messageId: uuid(),
              checkpoint: bigIntProcessorCheckpoint(2n),
              globalPosition: 2n,
              streamPosition: 2n,
            },
          },
        ];

        await processor.start();

        // When
        await processor.handle(recordedEvents, {});

        // Then
        assertEqual(handledMessages.length, 0);
      });
    });

    void it('should continue processing after skipping non-matching events in a mixed batch', async () => {
      // Given
      const processorId = uuid();
      const handledMessages: RecordedMessage[] = [];

      const processor = reactor({
        processorId,
        canHandle: ['test'],
        eachMessage: (message) => {
          handledMessages.push(message);
          return Promise.resolve();
        },
      });

      const event1: Event = { type: 'other', data: { value: 'skip me' } };
      const event2: TestEvent = { type: 'test', data: { counter: 1 } };
      const event3: Event = {
        type: 'another',
        data: { value: 'skip me too' },
      };
      const event4: TestEvent = { type: 'test', data: { counter: 2 } };

      const recordedEvents: RecordedMessage<
        Event,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      >[] = [
        {
          ...event1,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(1n),
            globalPosition: 1n,
            streamPosition: 1n,
          },
        },
        {
          ...event2,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(2n),
            globalPosition: 2n,
            streamPosition: 2n,
          },
        },
        {
          ...event3,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(3n),
            globalPosition: 3n,
            streamPosition: 3n,
          },
        },
        {
          ...event4,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(4n),
            globalPosition: 4n,
            streamPosition: 4n,
          },
        },
      ];

      await processor.start({});

      // When
      await processor.handle(recordedEvents, {});

      // Then
      assertEqual(handledMessages.length, 2);
      assertDeepEqual(handledMessages[0], recordedEvents[1]);
      assertDeepEqual(handledMessages[1], recordedEvents[3]);
    });

    void it('should read checkpoint on start', async () => {
      // Given
      const processorId = uuid();
      const checkpoint = bigIntProcessorCheckpoint(123n);

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        checkpoints: {
          read: () => Promise.resolve({ lastCheckpoint: checkpoint }),
          store: () => Promise.resolve({ success: true, newCheckpoint: null }),
        },
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertDeepEqual(startPosition, { lastCheckpoint: checkpoint });
    });

    void it('should store checkpoint after handling message', async () => {
      // Given
      const processorId = uuid();
      let storedCheckpoint: ProcessorCheckpoint | null = null;

      const checkpoints: Checkpointer<
        TestEvent,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      > = {
        read: () => Promise.resolve({ lastCheckpoint: null }),
        store: (options) => {
          const newCheckpoint = bigIntProcessorCheckpoint(
            options.message.metadata.globalPosition,
          );
          storedCheckpoint = newCheckpoint;
          return Promise.resolve({ success: true, newCheckpoint });
        },
      };

      const processor = reactor({
        processorId,
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      const event: TestEvent = { type: 'test', data: { counter: 1 } };
      const recordedEvent: RecordedMessage<
        TestEvent,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      > = {
        ...event,
        kind: 'Event',
        metadata: {
          streamName: 'test-stream',
          messageId: uuid(),
          checkpoint: bigIntProcessorCheckpoint(0n),
          globalPosition: 1n,
          streamPosition: 1n,
        },
      };
      await processor.start();

      // When
      await processor.handle([recordedEvent], {});

      // Then
      assertEqual(storedCheckpoint, bigIntProcessorCheckpoint(1n));
    });

    void it('handles only messages after the resolved checkpoint', async () => {
      const processorId = uuid();
      const handledMessages: RecordedMessage[] = [];

      const processor = reactor({
        processorId,
        startFrom: { lastCheckpoint: bigIntProcessorCheckpoint(2n) },
        eachMessage: (message) => {
          handledMessages.push(message);
          return Promise.resolve();
        },
      });

      const event: TestEvent = { type: 'test', data: { counter: 1 } };

      const recordedEvents: RecordedMessage<
        TestEvent,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      >[] = [1n, 2n, 3n, 4n].map((position) => ({
        ...event,
        kind: 'Event',
        metadata: {
          streamName: 'test-stream',
          messageId: uuid(),
          checkpoint: bigIntProcessorCheckpoint(position),
          globalPosition: position,
          streamPosition: position,
        },
      }));

      await processor.start({});

      await processor.handle(recordedEvents, {});

      assertEqual(handledMessages.length, 2);
      assertDeepEqual(handledMessages[0], recordedEvents[2]);
      assertDeepEqual(handledMessages[1], recordedEvents[3]);
    });
  });

  void describe('waiting until a processor catches up to appended messages', () => {
    const positionCheckpointer = (): Checkpointer<
      TestEvent,
      ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
    > => ({
      read: () => Promise.resolve({ lastCheckpoint: null }),
      store: (options) =>
        Promise.resolve({
          success: true,
          newCheckpoint: bigIntProcessorCheckpoint(
            options.message.metadata.globalPosition,
          ),
        }),
    });

    const recordedEvent = (
      position: bigint,
    ): RecordedMessage<
      TestEvent,
      ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
    > => ({
      type: 'test',
      kind: 'Event',
      data: { counter: Number(position) },
      metadata: {
        streamName: 'test-stream',
        messageId: uuid(),
        checkpoint: bigIntProcessorCheckpoint(position),
        globalPosition: position,
        streamPosition: position,
      },
    });

    void it('lets a test wait for its appended messages to be processed before asserting', async () => {
      // Given
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints: positionCheckpointer(),
      });
      await processor.start();

      let resolved = false;
      const whenProcessed = processor
        .whenProcessed(bigIntProcessorCheckpoint(2n))
        .then(() => {
          resolved = true;
        });

      // When - not yet at the target
      await processor.handle([recordedEvent(1n)], {});
      await Promise.resolve();

      // Then
      assertEqual(resolved, false);

      // When - reaching the target
      await processor.handle([recordedEvent(2n)], {});
      await whenProcessed;

      // Then
      assertEqual(resolved, true);
    });

    void it('does not hang when the messages were already processed before the wait', async () => {
      // Given
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints: positionCheckpointer(),
      });
      await processor.start();
      await processor.handle([recordedEvent(5n)], {});

      // When / Then - resolves without any further handling
      await processor.whenProcessed(bigIntProcessorCheckpoint(3n));
    });

    void it('fails fast with a clear error instead of hanging when the processor never catches up', async () => {
      // Given
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints: positionCheckpointer(),
      });
      await processor.start();

      // When / Then
      await assertRejects(
        processor.whenProcessed(bigIntProcessorCheckpoint(2n), { timeout: 20 }),
        (error: EmmettError) => error instanceof EmmettError,
      );
    });

    void it('resolves when the target batch is skipped', async () => {
      // Given
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => ({ type: 'SKIP' }),
        checkpoints: positionCheckpointer(),
      });
      await processor.start();

      let resolved = false;
      const whenProcessed = processor
        .whenProcessed(bigIntProcessorCheckpoint(2n))
        .then(() => {
          resolved = true;
        });

      // When
      await processor.handle([recordedEvent(1n), recordedEvent(2n)], {});
      await whenProcessed;

      // Then
      assertEqual(resolved, true);
    });

    void it('does not resolve past a stopped batch', async () => {
      // Given
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => ({ type: 'STOP' }),
        checkpoints: positionCheckpointer(),
      });
      await processor.start();

      // When
      await processor.handle([recordedEvent(1n), recordedEvent(2n)], {});

      // Then
      await assertRejects(
        processor.whenProcessed(bigIntProcessorCheckpoint(2n), {
          timeout: 20,
        }),
        (error: EmmettError) => error instanceof EmmettError,
      );
    });
  });

  void describe('skipping and stopping from a reactor', () => {
    type OrderPlaced = Event<'OrderPlaced', { amount: number }>;

    let charged: number[];
    beforeEach(() => {
      charged = [];
    });

    // the payment gateway the reactor calls on the critical revenue path
    const chargeCustomer = (amount: number): Promise<void> => {
      if (amount === 999) return Promise.reject(new Error('gateway timeout'));
      charged.push(amount);
      return Promise.resolve();
    };

    const paymentReactor = (processorId: string) => {
      // #region reactor-skip-stop
      const { skip, stop } = MessageProcessor.result;

      return reactor<OrderPlaced>({
        processorId,
        canHandle: ['OrderPlaced'],
        eachMessage: async (message) => {
          const { amount } = message.data;

          // a free order has nothing to charge: skip it, the reactor rolls on
          if (amount === 0) return skip({ reason: 'free order' });

          try {
            await chargeCustomer(amount);
          } catch {
            // charging is a critical path: a lost charge must not be skipped,
            // so stop the reactor and resume here once the problem is fixed
            return stop({
              reason: 'charge failed on the critical path',
              error: new EmmettError('payment charge failed'),
            });
          }
        },
      });
      // #endregion reactor-skip-stop
    };

    const orders = (
      amounts: number[],
    ): RecordedMessage<
      OrderPlaced,
      ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
    >[] =>
      amounts.map((amount, i) => ({
        type: 'OrderPlaced',
        kind: 'Event',
        data: { amount },
        metadata: {
          streamName: 'orders',
          messageId: uuid(),
          checkpoint: bigIntProcessorCheckpoint(BigInt(i + 1)),
          globalPosition: BigInt(i + 1),
          streamPosition: BigInt(i + 1),
        },
      }));

    void it('skips a message with nothing to do and keeps processing', async () => {
      const processor = paymentReactor(uuid());
      await processor.start();

      await processor.handle(orders([0, 100]), {});

      // the free order is skipped, so the reactor stays active and charges the next
      assertEqual(processor.isActive, true);
      assertDeepEqual(charged, [100]);
    });

    void it('stops the reactor when the critical path fails', async () => {
      const processor = paymentReactor(uuid());
      await processor.start();

      const result = await processor.handle(orders([999, 100]), {});

      // the stop halts the reactor, so the order after the failure never charges
      assertMatches(result, { type: 'STOP' });
      assertEqual(processor.isActive, false);
      assertDeepEqual(charged, []);
    });
  });

  void describe('start position resolution', () => {
    const trackingCheckpointer = (
      stored: ProcessorCheckpoint | null,
    ): {
      checkpoints: Checkpointer<TestEvent>;
      wasRead: () => boolean;
    } => {
      let read = false;
      return {
        checkpoints: {
          read: () => {
            read = true;
            return Promise.resolve({ lastCheckpoint: stored });
          },
          store: () => Promise.resolve({ success: true, newCheckpoint: null }),
        },
        wasRead: () => read,
      };
    };

    void it('resolves BEGINNING even when a checkpoint is stored', async () => {
      // Given
      const { checkpoints, wasRead } = trackingCheckpointer(
        bigIntProcessorCheckpoint(9n),
      );
      const processor = reactor({
        processorId: uuid(),
        startFrom: 'BEGINNING',
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertEqual(startPosition, 'BEGINNING');
      assertEqual(wasRead(), true);
    });

    void it('resolves an explicit checkpoint after reading the stored checkpoint', async () => {
      // Given
      const provided = bigIntProcessorCheckpoint(5n);
      const { checkpoints, wasRead } = trackingCheckpointer(
        bigIntProcessorCheckpoint(9n),
      );
      const processor = reactor({
        processorId: uuid(),
        startFrom: { lastCheckpoint: provided },
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertDeepEqual(startPosition, { lastCheckpoint: provided });
      assertEqual(wasRead(), true);
    });

    void it('resolves the default to BEGINNING when no checkpoint is stored', async () => {
      // Given
      const { checkpoints } = trackingCheckpointer(null);
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertEqual(startPosition, 'BEGINNING');
    });

    void it('resolves the default to the stored checkpoint when present', async () => {
      // Given
      const stored = bigIntProcessorCheckpoint(7n);
      const { checkpoints } = trackingCheckpointer(stored);
      const processor = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertDeepEqual(startPosition, { lastCheckpoint: stored });
    });

    void it('treats CURRENT as a deprecated alias of the default', async () => {
      // Given
      const stored = bigIntProcessorCheckpoint(7n);
      const withCurrent = reactor({
        processorId: uuid(),
        startFrom: 'CURRENT',
        eachMessage: () => Promise.resolve(),
        checkpoints: trackingCheckpointer(stored).checkpoints,
      });
      const withDefault = reactor({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        checkpoints: trackingCheckpointer(stored).checkpoints,
      });

      // When
      const currentPosition = await withCurrent.start({});
      const defaultPosition = await withDefault.start({});

      // Then
      assertDeepEqual(currentPosition, defaultPosition);
      assertDeepEqual(currentPosition, { lastCheckpoint: stored });
    });

    void it('returns END verbatim, leaving the consumer to resolve the tail', async () => {
      // Given
      const { checkpoints, wasRead } = trackingCheckpointer(
        bigIntProcessorCheckpoint(9n),
      );
      const processor = reactor({
        processorId: uuid(),
        startFrom: 'END',
        eachMessage: () => Promise.resolve(),
        checkpoints,
      });

      // When
      const startPosition = await processor.start({});

      // Then
      assertEqual(startPosition, 'END');
      assertEqual(wasRead(), true);
    });
  });

  void describe('projector', () => {
    void it('should create projector with default options', () => {
      // Given
      const projectionName = uuid();

      // When
      const processor = projector({
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertMatches(processor, {
        id: `emt:processor:projector:${projectionName}`,
        type: 'projector',
      });
      assertOk(isString(processor.instanceId));
    });

    void it('should call truncate on start if truncateOnStart is true', async () => {
      // Given
      const projectionName = uuid();
      let truncateCalled = false;

      const processor = projector({
        truncateOnStart: true,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
          truncate: () => {
            truncateCalled = true;
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start();

      // Then
      assertEqual(truncateCalled, true);
    });

    void it('should call projection handle for events it can handle', async () => {
      // Given
      const projectionName = uuid();
      const handledEvents: RecordedMessage<Event>[] = [];

      const processor = projector({
        projection: {
          name: projectionName,
          canHandle: ['test'],
          handle: (events) => {
            handledEvents.push(...events);
            return Promise.resolve();
          },
        },
      });

      const event1: TestEvent = { type: 'test', data: { counter: 1 } };
      const event2: Event = {
        type: 'other',
        data: { counter: 2 },
      };

      const recordedEvents: RecordedMessage<
        Event,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      >[] = [
        {
          ...event1,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(1n),
            globalPosition: 1n,
            streamPosition: 1n,
          },
        },
        {
          ...event2,
          kind: 'Event',
          metadata: {
            streamName: 'test-stream',
            messageId: uuid(),
            checkpoint: bigIntProcessorCheckpoint(2n),
            globalPosition: 2n,
            streamPosition: 2n,
          },
        },
      ];

      await processor.start();

      // When
      await processor.handle(recordedEvents, {});

      // Then
      assertEqual(handledEvents.length, 1);
      assertDeepEqual(handledEvents[0], recordedEvents[0]);
    });

    void it('should use custom processorId when provided', () => {
      // Given
      const projectionName = uuid();
      const customProcessorId = `custom:processor:${uuid()}`;

      // When
      const processor = projector({
        processorId: customProcessorId,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertEqual(processor.id, customProcessorId);
    });

    void it('should not call truncate on start if truncateOnStart is false', async () => {
      // Given
      const projectionName = uuid();
      let truncateCalled = false;

      const processor = projector({
        truncateOnStart: false,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
          truncate: () => {
            truncateCalled = true;
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start();

      // Then
      assertEqual(truncateCalled, false);
    });

    void it('should not call truncate on start by default', async () => {
      // Given
      const projectionName = uuid();
      let truncateCalled = false;

      const processor = projector({
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
          truncate: () => {
            truncateCalled = true;
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start();

      // Then
      assertEqual(truncateCalled, false);
    });

    void it('should call onStart hook before projection init', async () => {
      // Given
      const projectionName = uuid();
      const callOrder: string[] = [];

      const processor = projector({
        truncateOnStart: true,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
          truncate: () => {
            callOrder.push('truncate');
            return Promise.resolve();
          },
        },
        hooks: {
          onStart: () => {
            callOrder.push('onStart');
            return Promise.resolve();
          },
        },
      });

      // When
      await processor.start();

      // Then
      assertDeepEqual(callOrder, ['truncate', 'onStart']);
    });

    void it('should generate unique instanceId for each projector', () => {
      // Given
      const projectionName = uuid();

      // When
      const processor1 = projector({
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      const processor2 = projector({
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertOk(processor1.instanceId !== processor2.instanceId);
    });

    void it('should use provided processorInstanceId when specified', () => {
      // Given
      const projectionName = uuid();
      const customInstanceId = `instance:${uuid()}`;

      // When
      const processor = projector({
        processorInstanceId: customInstanceId,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertEqual(processor.instanceId, customInstanceId);
    });
  });
});

void describe('comparing checkpoints', () => {
  const rawRecordedEvent = (
    checkpoint: string,
  ): RecordedMessage<
    TestEvent,
    ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
  > => ({
    type: 'test',
    kind: 'Event',
    data: { counter: 0 },
    metadata: {
      streamName: 'test-stream',
      messageId: uuid(),
      checkpoint: ProcessorCheckpoint(checkpoint),
      globalPosition: BigInt(checkpoint),
      streamPosition: BigInt(checkpoint),
    },
  });

  void describe('wasMessageHandled', () => {
    void it('uses the provided comparator to decide whether a message was handled', () => {
      // '10' <= '9' lexicographically (native), but 10 <= 9 is false numerically
      const message = rawRecordedEvent('10');

      assertEqual(
        wasMessageHandled(
          message,
          ProcessorCheckpoint('9'),
          numericCompareCheckpoints,
        ),
        false,
      );
    });
  });

  void it('uses the provided comparator when deciding whether a checkpoint was processed', async () => {
    // Given
    const checkpoint = ProcessorCheckpoint('10');
    const message = rawRecordedEvent('10');
    const processor = reactor({
      processorId: uuid(),
      compareCheckpoints: numericCompareCheckpoints,
      eachMessage: () => Promise.resolve(),
      checkpoints: {
        read: () => Promise.resolve({ lastCheckpoint: null }),
        store: () =>
          Promise.resolve({
            success: true,
            newCheckpoint: checkpoint,
          }),
      },
    });
    await processor.start();

    // When - processed up to checkpoint '10'
    await processor.handle([message], {});

    // Then - '10' is past '9' numerically, so the wait resolves rather than
    // timing out as it would under lexicographic string comparison
    await processor.whenProcessed(ProcessorCheckpoint('9'), { timeout: 100 });
  });
});
