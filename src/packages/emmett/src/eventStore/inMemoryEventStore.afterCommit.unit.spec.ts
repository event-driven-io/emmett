import { ObservabilitySpec } from '@event-driven-io/almanac';
import { v7 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import { EmmettAttributes, EmmettSpans } from '../observability/attributes';
import { assertDeepEqual, assertEqual } from '../testing';
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
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
        },
      },
    });
    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
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
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
        },
      },
    });
    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
        metadata: { some: false },
      },
    ];
    const nextEvents: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 3 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 4 },
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
      hooks: {
        onAfterCommit: (events) => {
          appendedEvents.push(...events);
          throw new Error('onAfterCommit failed!');
        },
      },
    });

    const streamName = `test:${uuid()}`;

    const events: TestEvent[] = [
      {
        type: 'test',
        data: { counter: 1 },
        metadata: { some: true },
      },
      {
        type: 'test',
        data: { counter: 2 },
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

  void describe('observability', () => {
    const given = ObservabilitySpec.for();

    const events: TestEvent[] = [
      { type: 'test', data: { counter: 1 }, metadata: { some: true } },
      { type: 'test', data: { counter: 2 }, metadata: { some: false } },
    ];

    void it('a failing onAfterCommit hook logs one error in an on_after_commit span and the append succeeds', async () => {
      const streamName = `test:${uuid()}`;
      const failure = new Error('onAfterCommit failed!');

      await given((config) =>
        getInMemoryEventStore({
          observability: config,
          hooks: {
            onAfterCommit: () => {
              throw failure;
            },
          },
        }),
      )
        .when(async (eventStore, config) => {
          const result = await eventStore.appendToStream(streamName, events);
          const errorLogs = config.tracer.spans.flatMap((s) =>
            s.logs.filter((l) => l.metadata.level === 'error'),
          );
          return { result, errorLogs };
        })
        .then(({ result: { result, errorLogs }, spans }) => {
          assertEqual(2n, result.nextExpectedStreamVersion);
          spans
            .hasSingleSpanNamed(EmmettSpans.eventStore.onAfterCommit)
            .hasParentSpanNamed('eventStore.appendToStream')
            .hasAttributes({
              [EmmettAttributes.stream.name]: streamName,
              [EmmettAttributes.eventStore.append.batchSize]: 2,
            })
            .hasError(failure)
            .logged('error', 'onAfterCommit hook failed', {
              [EmmettAttributes.stream.name]: streamName,
              [EmmettAttributes.eventStore.append.batchSize]: 2,
            })
            .loggedCount(1);
          assertEqual(1, errorLogs.length);
          assertDeepEqual(errorLogs[0]!.data.error, failure);
        });
    });

    void it('the append span stays OK when the hook fails', async () => {
      await given((config) =>
        getInMemoryEventStore({
          observability: config,
          hooks: {
            onAfterCommit: () => {
              throw new Error('onAfterCommit failed!');
            },
          },
        }),
      )
        .when((eventStore) =>
          eventStore.appendToStream(`test:${uuid()}`, events),
        )
        .then(({ spans }) =>
          spans.hasSingleSpanNamed('eventStore.appendToStream').hasNoError(),
        );
    });

    void it('a successful hook runs in an on_after_commit span and logs nothing', async () => {
      await given((config) =>
        getInMemoryEventStore({
          observability: config,
          hooks: { onAfterCommit: () => {} },
        }),
      )
        .when((eventStore) =>
          eventStore.appendToStream(`test:${uuid()}`, events),
        )
        .then(({ spans }) =>
          spans
            .hasSingleSpanNamed(EmmettSpans.eventStore.onAfterCommit)
            .hasParentSpanNamed('eventStore.appendToStream')
            .hasNoError()
            .noLogs(),
        );
    });
  });
});
