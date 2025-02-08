import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { assertDeepEqual, assertEqual } from '../../testing';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import type { EventStore } from '../eventStore';
import { type InMemoryReadEvent } from '../inMemoryEventStore';
import { tryPublishMessagesAfterCommit } from './afterEventStoreCommitHandler';

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
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

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

  void it('calls onAfterCommit hook exactly once for each events append', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];

    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestReadEvent[] = [
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];
    const nextEvents: TestReadEvent[] = [
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

    // When
    await tryPublishMessagesAfterCommit<TestEventStore>(events, {
      onAfterCommit: (
        events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
      ) => {
        appendedEvents.push(...events);
      },
    });
    await tryPublishMessagesAfterCommit<TestEventStore>(nextEvents, {
      onAfterCommit: (
        events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
      ) => {
        appendedEvents.push(...events);
      },
    });

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
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: true,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
      {
        kind: 'Event',
        type: 'test',
        data: { counter: ++counter },
        metadata: {
          some: false,
          messageId: uuid(),
          globalPosition: 1n,
          streamName,
          streamPosition: 1n,
        },
      },
    ];

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
