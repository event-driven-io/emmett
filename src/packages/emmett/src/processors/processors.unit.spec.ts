import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertOk,
} from '../testing';
import type { Event, ReadEventMetadata, RecordedMessage } from '../typing';
import { isString } from '../validation';
import { projector, reactor, type Checkpointer } from './processors';

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
      await processor.start({});

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

      await processor.start({});

      // When
      await processor.close({});

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
      await processor.start({});
      assertEqual(processor.isActive, true);

      await processor.close({});

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

      await processor.start({});

      // When
      await processor.close({});
      await processor.close({});
      await processor.close({});

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

      await processor.start({});

      // When/Then - should not throw
      await processor.close({});
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

      await processor.start({});
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

      await processor.start({});
      assertEqual(processor.isActive, true);

      // When
      process.emit('SIGINT');
      await Promise.resolve();

      // Then
      assertEqual(processor.isActive, false);
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

      await processor.start({});

      // When - close manually
      await processor.close({});
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
              globalPosition: 2n,
              streamPosition: 2n,
            },
          },
        ];

        await processor.start({});

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
              globalPosition: 2n,
              streamPosition: 2n,
            },
          },
        ];

        await processor.start({});

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
      const checkpoint = 123n;

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
      let storedCheckpoint: bigint | null = null;

      const checkpoints: Checkpointer<
        TestEvent,
        ReadEventMetadata & { globalPosition: bigint; streamPosition: bigint }
      > = {
        read: () => Promise.resolve({ lastCheckpoint: null }),
        store: (options) => {
          const newCheckpoint = options.message.metadata.globalPosition;
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
          globalPosition: 1n,
          streamPosition: 1n,
        },
      };
      await processor.start({});

      // When
      await processor.handle([recordedEvent], {});

      // Then
      assertEqual(storedCheckpoint, 1n);
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
      await processor.start({});

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
            globalPosition: 2n,
            streamPosition: 2n,
          },
        },
      ];

      await processor.start({});

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
      await processor.start({});

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
      await processor.start({});

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
      await processor.start({});

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
