import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { assertEqual } from '../testing';
import type { Event } from '../typing';
import {
  getInMemoryEventStore,
  type InMemoryReadEvent,
} from './inMemoryEventStore';

type TestEvent = Event<'test', { counter: number }, { some: boolean }>;

void describe('InMemoryEventStore onAfterCommit', () => {
  void it('calls onAfterCommit hook after events append', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];
    const eventStore = getInMemoryEventStore({
      onAfterCommit: (events) => {
        appendedEvents.push(...events);
      },
    });
    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);

    // Then
    assertEqual(2, appendedEvents.length);
  });

  void it('calls onAfterCommit hook exactly once for each events append', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];
    const eventStore = getInMemoryEventStore({
      onAfterCommit: (events) => {
        appendedEvents.push(...events);
      },
    });
    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: false },
      },
    ];
    const nextEvents: TestEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);
    await eventStore.appendToStream(streamName, nextEvents);

    // Then
    assertEqual(4, appendedEvents.length);
  });

  void it('silently fails when onAfterCommit hook failed but still keeps events', async () => {
    // Given
    const appendedEvents: InMemoryReadEvent[] = [];
    const eventStore = getInMemoryEventStore({
      onAfterCommit: (events) => {
        appendedEvents.push(...events);
        throw new Error('onAfterCommit failed!');
      },
    });
    const streamName = `test:${uuid()}`;
    let counter = 0;
    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: ++counter },
        metadata: { some: false },
      },
    ];

    // When
    await eventStore.appendToStream(streamName, events);

    // Then
    assertEqual(2, appendedEvents.length);
    const { events: eventsInStore } = await eventStore.readStream(streamName);
    assertEqual(2, eventsInStore.length);
  });
});
