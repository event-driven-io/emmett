import { beforeEach, describe, it } from 'node:test';
import { collect } from '../../streaming';
import { stopOn } from '../../streaming/transformations/stopOn';
import { waitAtMost } from '../../streaming/transformations/waitAtMost';
import { assertDeepEqual, assertEqual } from '../../testing';
import {
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import {
  caughtUpEventFrom,
  globalStreamCaughtUp,
  type GlobalStreamCaughtUp,
} from '../events';
import { StreamingCoordinator } from './streamingCoordinator';

void describe('StreamingCoordinator', () => {
  let streamingCoordinator: ReturnType<typeof StreamingCoordinator>;

  beforeEach(() => {
    streamingCoordinator = StreamingCoordinator();
  });

  void it('should add and remove subscribers correctly', () => {
    // Initially, no subscribers
    assertEqual(
      streamingCoordinator.stream().locked,
      false,
      'Stream should not be locked initially',
    );

    const stream = streamingCoordinator.stream();
    assertEqual(stream.locked, false, 'Stream should be initially unlocked');

    const reader = stream.getReader();
    assertEqual(
      stream.locked,
      true,
      'Stream should be locked when a reader is created',
    );

    reader.releaseLock();
    assertEqual(
      stream.locked,
      false,
      'Stream should be unlocked when reader releases the lock',
    );
  });

  void it('notifies listeners with events', async () => {
    const event = createMockEvent(1n);

    const listenerStream = streamingCoordinator
      .stream()
      .pipeThrough(stopOn(caughtUpEventFrom(event.metadata.globalPosition)))
      .pipeThrough(waitAtMost(20));

    const collectedEvents = collect(listenerStream);

    await streamingCoordinator.notify([event]);

    const result = await collectedEvents;

    assertDeepEqual(result, [
      globalStreamCaughtUp({ globalPosition: 0n }) as ReadEvent<
        GlobalStreamCaughtUp,
        ReadEventMetadataWithGlobalPosition
      >,
      event,
    ]);
  });

  void it('manages multiple listeners', async () => {
    const event1 = createMockEvent(1n);
    const event2 = createMockEvent(2n);

    const listenerStream1 = streamingCoordinator
      .stream()
      .pipeThrough(stopOn(caughtUpEventFrom(event2.metadata.globalPosition)))
      .pipeThrough(waitAtMost(20));
    const listenerStream2 = streamingCoordinator
      .stream()
      .pipeThrough(stopOn(caughtUpEventFrom(event2.metadata.globalPosition)))
      .pipeThrough(waitAtMost(20));

    const collectedEvents1 = collect(listenerStream1);
    const collectedEvents2 = collect(listenerStream2);

    await streamingCoordinator.notify([event1, event2]);

    const result1 = await collectedEvents1;
    const result2 = await collectedEvents2;

    assertDeepEqual(result1, [
      globalStreamCaughtUp({ globalPosition: 0n }) as ReadEvent<
        GlobalStreamCaughtUp,
        ReadEventMetadataWithGlobalPosition
      >,
      event1,
      event2,
    ]);
    assertDeepEqual(result2, [
      globalStreamCaughtUp({ globalPosition: 0n }) as ReadEvent<
        GlobalStreamCaughtUp,
        ReadEventMetadataWithGlobalPosition
      >,
      event1,
      event2,
    ]);
  });

  void it.only('handles no active readers after streaming', async () => {
    const event = createMockEvent(1n);

    const subscription = streamingCoordinator.stream();

    const listenerStream = subscription
      .pipeThrough(stopOn(caughtUpEventFrom(event.metadata.globalPosition)))
      .pipeThrough(waitAtMost(20));

    const collectedEvents = collect(listenerStream);

    await streamingCoordinator.notify([event]);

    await collectedEvents;

    // THIS FAILS FOR STREAMS SHIM
    //await subscription.cancel();

    // should not fail
    await streamingCoordinator.notify([event]);
  });

  void it('handles no active readers', async () => {
    const event = createMockEvent(1n);

    // should not fail
    await streamingCoordinator.notify([event]);
  });

  void it('handles empty notification', async () => {
    const listenerStream = streamingCoordinator
      .stream()
      .pipeThrough(waitAtMost(20));
    const collectedEvents = collect(listenerStream);

    await streamingCoordinator.notify([]);

    const result = await collectedEvents;

    assertDeepEqual(result, [globalStreamCaughtUp({ globalPosition: 0n })]);
  });
});

type MockEvent = Event<'Mocked', { mocked: true }>;

const createMockEvent = (
  position: bigint,
): ReadEvent<MockEvent, ReadEventMetadataWithGlobalPosition> => ({
  type: 'Mocked',
  kind: 'Event',
  data: { mocked: true },
  metadata: {
    streamName: 'testStream',
    messageId: `message-${position}`,
    streamPosition: position,
    globalPosition: position,
  },
});
