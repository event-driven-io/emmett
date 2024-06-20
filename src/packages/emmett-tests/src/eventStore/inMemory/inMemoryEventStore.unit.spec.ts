import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  StreamingCoordinator,
  getInMemoryEventStore,
  isGlobalStreamCaughtUp,
} from '../eventStore';
import { collect, streamTransformations } from '../streaming';
import { type Event } from '../typing';

const { stopOn } = streamTransformations;

type MockEvent = Event<'Mocked', { mocked: true }>;

// const createMockEvent = (position: bigint) => ({
//   type: 'Mocked',
//   data: { mocked: true },
//   metadata: {
//     streamName: 'testStream',
//     eventId: `event-${position}`,
//     streamPosition: position,
//     globalPosition: position,
//   },
// });

// type SubscriptionDomainEvent = ReadEvent<
//   Event,
//   ReadEventMetadataWithGlobalPosition
// >;

// type SubscriptionEvent = SubscriptionDomainEvent | GlobalStreamCaughtUp;

// const createCaughtUpEvent = (position: bigint): GlobalStreamCaughtUp => ({
//   type: '__emt:GlobalStreamCaughtUp',
//   data: { globalPosition: position },
// });

void describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();
  //void testAggregateStream(() => Promise.resolve(eventStore));

  void it('Successful subscription and processing of events', async () => {
    const streamName = 'test-stream';

    const events: MockEvent[] = [
      { type: 'Mocked', data: { mocked: true } },
      { type: 'Mocked', data: { mocked: true } },
    ];

    await eventStore.appendToStream(streamName, events);

    // Subscribe to the stream and process events
    const readableStream = eventStore
      .streamEvents()
      .pipeThrough(stopOn(isGlobalStreamCaughtUp));

    const receivedEvents = await collect(readableStream);

    assert.strictEqual(receivedEvents.length, events.length);
  });
});

void describe('SubscriptionsCoordinator', () => {
  // Test the SubscriptionsCoordinator
  void it('should add and remove subscribers correctly', () => {
    const coordinator = StreamingCoordinator();

    // Initially, no subscribers
    assert.strictEqual(
      coordinator.stream().locked,
      false,
      'Stream should not be locked initially',
    );

    const stream = coordinator.stream();
    assert.strictEqual(
      stream.locked,
      false,
      'Stream should be initially unlocked',
    );

    const reader = stream.getReader();
    assert.strictEqual(
      stream.locked,
      true,
      'Stream should be locked when a reader is created',
    );

    reader.releaseLock();
    assert.strictEqual(
      stream.locked,
      false,
      'Stream should be unlocked when reader releases the lock',
    );
  });

  // void it('should notify active subscribers', async () => {
  //   const coordinator = SubscriptionsCoordinator();

  //   const stream1 = coordinator.subscribe();
  //   const stream2 = coordinator.subscribe();

  //   const reader1 = stream1.getReader();
  //   const reader2 = stream2.getReader();

  //   const receivedEvents1: SubscriptionEvent[] = [];
  //   const receivedEvents2: SubscriptionEvent[] = [];

  //   const readAllEvents = async (
  //     reader: ReadableStreamDefaultReader<SubscriptionEvent>,
  //     receivedEvents: SubscriptionEvent[],
  //   ) => {
  //     let isDone: boolean;
  //     do {
  //       const { done, value } = await reader.read();
  //       isDone = done;
  //       if (done) break;
  //       receivedEvents.push(value);
  //     } while (!isDone);
  //   };

  //   readAllEvents(reader1, receivedEvents1).catch(assert.fail);
  //   readAllEvents(reader2, receivedEvents2).catch(assert.fail);

  //   // Notify events to all subscribers
  //   const events = [createMockEvent(1n), createMockEvent(2n)];
  //   await coordinator.notify(events);

  //   assert.deepStrictEqual(
  //     receivedEvents1.filter(isNotSubscriptionEvent),
  //     events,
  //     'Stream 1 should receive all events',
  //   );
  //   assert.deepStrictEqual(
  //     receivedEvents2.filter(isNotSubscriptionEvent),
  //     events,
  //     'Stream 2 should receive all events',
  //   );

  //   reader1.releaseLock();
  //   reader2.releaseLock();
  // });

  // test('CaughtUpTransformStream should cleanup when no active readers', async (t) => {
  //   const coordinator = SubscriptionsCoordinator();
  //   const stream = coordinator.subscribe();

  //   let cleanupCalled = false;
  //   const mockCaughtUpTransformStream = new CaughtUpTransformStream([], () => {
  //     cleanupCalled = true;
  //   });

  //   // Simulate adding the stream
  //   coordinator.subscribe();
  //   assert.strictEqual(
  //     stream.locked,
  //     false,
  //     'Stream should be unlocked initially',
  //   );

  //   // Obtain a reader
  //   const reader = stream.getReader();
  //   assert.strictEqual(
  //     stream.locked,
  //     true,
  //     'Stream should be locked when a reader is created',
  //   );

  //   // Release the lock
  //   reader.releaseLock();

  //   // Allow some time for the cleanup to be detected
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   assert.strictEqual(
  //     cleanupCalled,
  //     true,
  //     'Cleanup should be called when there are no active readers',
  //   );
  // });

  // // Additional tests for pipeThrough with stopOn
  // test('CaughtUpTransformStream should stop and clean up when pipeThrough stopOn catches the event', async (t) => {
  //   const coordinator = SubscriptionsCoordinator();

  //   const stream = coordinator
  //     .subscribe()
  //     .pipeThrough(stopOn(isGlobalStreamCaughtUp));

  //   const reader = stream.getReader();
  //   const receivedEvents = [];

  //   const readAllEvents = async () => {
  //     while (true) {
  //       const { done, value } = await reader.read();
  //       if (done) break;
  //       receivedEvents.push(value);
  //     }
  //   };

  //   readAllEvents();

  //   // Notify events to the subscriber
  //   const events = [
  //     createMockEvent(1),
  //     createCaughtUpEvent(2),
  //     createMockEvent(3),
  //   ];
  //   await coordinator.notify(events);

  //   // Allow some time for the notifications to be processed
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   assert.strictEqual(
  //     receivedEvents.length,
  //     2,
  //     'Stream should only receive events until the caught up event',
  //   );
  //   assert.deepStrictEqual(
  //     receivedEvents,
  //     [createMockEvent(1), createCaughtUpEvent(2)],
  //     'Stream should receive events up to the caught up event',
  //   );

  //   reader.releaseLock();
  // });

  // test('CaughtUpTransformStream handles multiple subscriptions with pipeThrough', async (t) => {
  //   const coordinator = SubscriptionsCoordinator();

  //   const stream1 = coordinator
  //     .subscribe()
  //     .pipeThrough(stopOn(isGlobalStreamCaughtUp));
  //   const stream2 = coordinator
  //     .subscribe()
  //     .pipeThrough(stopOn(isGlobalStreamCaughtUp));

  //   const reader1 = stream1.getReader();
  //   const reader2 = stream2.getReader();

  //   const receivedEvents1 = [];
  //   const receivedEvents2 = [];

  //   const readAllEvents = async (reader, receivedEvents) => {
  //     while (true) {
  //       const { done, value } = await reader.read();
  //       if (done) break;
  //       receivedEvents.push(value);
  //     }
  //   };

  //   readAllEvents(reader1, receivedEvents1);
  //   readAllEvents(reader2, receivedEvents2);

  //   // Notify events to all subscribers
  //   const events = [
  //     createMockEvent(1),
  //     createCaughtUpEvent(2),
  //     createMockEvent(3),
  //   ];
  //   await coordinator.notify(events);

  //   // Allow some time for the notifications to be processed
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   assert.deepStrictEqual(
  //     receivedEvents1,
  //     [createMockEvent(1), createCaughtUpEvent(2)],
  //     'Stream 1 should receive events up to the caught up event',
  //   );
  //   assert.deepStrictEqual(
  //     receivedEvents2,
  //     [createMockEvent(1), createCaughtUpEvent(2)],
  //     'Stream 2 should receive events up to the caught up event',
  //   );

  //   reader1.releaseLock();
  //   reader2.releaseLock();
  // });
});
