import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { getInMemoryMessageBus } from '../../messageBus';
import { assertDeepEqual, assertEqual } from '../../testing';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import type { EventStore } from '../eventStore';
import { type InMemoryReadEvent } from '../inMemoryEventStore';
import { tryPublishMessagesAfterCommit } from './afterEventStoreCommitHandler';
import { forwardToMessageBus } from './forwardToMessageBus';

type TestEvent = Event<'test', { counter: number }, { some: boolean }>;

type TestEventStore = EventStore<ReadEventMetadataWithGlobalPosition>;

type TestReadEvent = ReadEvent<
  TestEvent,
  TestEvent['metadata'] & ReadEventMetadataWithGlobalPosition
>;

void describe('InMemoryEventStore onAfterCommit', () => {
  void it('calls onAfterCommit hook after events append', async () => {
    // Given
    const appendedEvents: ReadEvent<
      Event,
      ReadEventMetadataWithGlobalPosition
    >[] = [];

    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestReadEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

    const messageBus = getInMemoryMessageBus();
    messageBus.subscribe((event: TestReadEvent) => {
      appendedEvents.push(event);
    }, 'test');

    // When
    await tryPublishMessagesAfterCommit<TestEventStore>(events, {
      onAfterCommit: forwardToMessageBus(messageBus),
    });

    // Then
    assertEqual(2, appendedEvents.length);
    assertDeepEqual(appendedEvents, events);
  });

  void it('calls onAfterCommit hook exactly once for each events append', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];

    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestReadEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];
    const nextEvents: TestReadEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

    const messageBus = getInMemoryMessageBus();
    messageBus.subscribe((event: TestReadEvent) => {
      appendedEvents.push(event);
    }, 'test');

    // When
    const options = {
      onAfterCommit: forwardToMessageBus(messageBus),
    };
    await tryPublishMessagesAfterCommit<TestEventStore>(events, options);
    await tryPublishMessagesAfterCommit<TestEventStore>(nextEvents, options);

    // Then
    assertEqual(4, appendedEvents.length);
    assertDeepEqual(appendedEvents, [...events, ...nextEvents]);
  });

  void it('silently fails when onAfterCommit hook failed but still keeps events', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];

    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestReadEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          eventId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

    const messageBus = getInMemoryMessageBus();
    messageBus.subscribe((event: TestReadEvent) => {
      appendedEvents.push(event);
    }, 'test');

    // When
    await tryPublishMessagesAfterCommit<TestEventStore>(events, {
      onAfterCommit: (
        events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
      ) => {
        appendedEvents.push(...events);
      },
    });

    // Then
    assertEqual(2, appendedEvents.length);
    assertDeepEqual(appendedEvents, events);
  });
});