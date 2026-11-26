import { v4 as uuid } from 'uuid';
import { describe, expectTypeOf, it } from 'vitest';
import { getProjectorId } from '../../processors';
import { projections, type ProjectionDefinition } from '../../projections';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertThatArray,
} from '../../testing';
import type { Event, ReadEvent } from '../../typing';
import {
  getInMemoryEventStore,
  type InMemoryProjectionHandlerContext,
  type InMemoryReadEventMetadata,
} from '../inMemoryEventStore';
import { inMemorySingleStreamProjection } from '../projections';

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;
type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type GuestSummary = {
  _id?: string;
  _version?: bigint;
  checkIns: number;
  checkOuts: number;
};

type CheckpointDocument = {
  _id: string;
  lastCheckpoint: string | null;
  _version?: bigint;
};

const withDeadline = { timeout: 30000 };

const guestSummaryProjection = (collectionName: string) => ({
  ...inMemorySingleStreamProjection({
    collectionName,
    canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
    initialState: (): GuestSummary => ({ checkIns: 0, checkOuts: 0 }),
    evolve: (
      document: GuestSummary,
      { type }: ReadEvent<GuestStayEvent>,
    ): GuestSummary =>
      type === 'GuestCheckedIn'
        ? { ...document, checkIns: document.checkIns + 1 }
        : { ...document, checkOuts: document.checkOuts + 1 },
  }),
  name: collectionName,
});

const guestStay = () => {
  const guestId = uuid();
  const streamName = `guestStay-${guestId}`;
  const events: GuestStayEvent[] = [
    { type: 'GuestCheckedIn', data: { guestId } },
    { type: 'GuestCheckedOut', data: { guestId } },
  ];
  return { guestId, streamName, events };
};

void describe('In-memory event store async projections', () => {
  void it(`append doesn't run async projections`, withDeadline, async () => {
    const eventStore = getInMemoryEventStore({
      projections: projections.async([
        guestSummaryProjection('asyncSummaries'),
      ]),
    });
    const { streamName, events } = guestStay();

    await eventStore.appendToStream(streamName, events);

    const summary = await eventStore.database
      .collection<GuestSummary>('asyncSummaries')
      .findOne((d) => d._id === streamName);
    assertEqual(summary, null);
  });

  void it(
    'consumer with includeAsyncProjections runs them',
    withDeadline,
    async () => {
      const eventStore = getInMemoryEventStore({
        projections: projections.async([
          guestSummaryProjection('asyncSummaries'),
        ]),
      });
      const consumer = eventStore.consumer({ includeAsyncProjections: true });
      const { streamName, events } = guestStay();

      const consumerPromise = consumer.start();
      try {
        await eventStore.appendToStream(streamName, events);
        await consumer.whenCaughtUp();

        const summary = await eventStore.database
          .collection<GuestSummary>('asyncSummaries')
          .findOne((d) => d._id === streamName);
        assertDeepEqual(summary, {
          _id: streamName,
          _version: 2n,
          checkIns: 1,
          checkOuts: 1,
        });
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );

  void it(`consumer without includeAsyncProjections doesn't add them`, () => {
    const eventStore = getInMemoryEventStore({
      projections: projections.async([
        guestSummaryProjection('asyncSummaries'),
      ]),
    });

    const consumer = eventStore.consumer();

    assertThatArray([...consumer.processors]).isEmpty();
  });

  void it(`consumer with includeAsyncProjections doesn't add inline projections`, () => {
    const eventStore = getInMemoryEventStore({
      projections: [
        ...projections.inline([guestSummaryProjection('inlineSummaries')]),
        ...projections.async([guestSummaryProjection('asyncSummaries')]),
      ],
    });

    const consumer = eventStore.consumer({ includeAsyncProjections: true });

    assertDeepEqual(
      consumer.processors.map(({ id }) => id),
      [getProjectorId({ projectionName: 'asyncSummaries' })],
    );
  });

  void it(
    'inline projections still run during append',
    withDeadline,
    async () => {
      const eventStore = getInMemoryEventStore({
        projections: [
          ...projections.inline([guestSummaryProjection('inlineSummaries')]),
          ...projections.async([guestSummaryProjection('asyncSummaries')]),
        ],
      });
      const { streamName, events } = guestStay();

      await eventStore.appendToStream(streamName, events);

      const inline = await eventStore.database
        .collection<GuestSummary>('inlineSummaries')
        .findOne((d) => d._id === streamName);
      const async = await eventStore.database
        .collection<GuestSummary>('asyncSummaries')
        .findOne((d) => d._id === streamName);
      assertDeepEqual(inline, {
        _id: streamName,
        _version: 2n,
        checkIns: 1,
        checkOuts: 1,
      });
      assertEqual(async, null);
    },
  );

  void describe('handler context', () => {
    const contextCapturingProjection = (
      seen: InMemoryProjectionHandlerContext[],
    ): ProjectionDefinition<
      GuestStayEvent,
      InMemoryReadEventMetadata,
      InMemoryProjectionHandlerContext
    > => ({
      name: 'contextCapturing',
      canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
      handle: (_events, context) => {
        seen.push(context);
        return Promise.resolve();
      },
    });

    const runProjection = async (
      type: 'inline' | 'async',
      seen: InMemoryProjectionHandlerContext[],
    ) => {
      const eventStore = getInMemoryEventStore({
        projections: projections[type]([contextCapturingProjection(seen)]),
      });
      const { streamName, events } = guestStay();

      if (type === 'inline') {
        await eventStore.appendToStream(streamName, events);
        return eventStore;
      }

      const consumer = eventStore.consumer({ includeAsyncProjections: true });
      const consumerPromise = consumer.start();
      try {
        await eventStore.appendToStream(streamName, events);
        await consumer.whenCaughtUp();
      } finally {
        await consumer.close();
        await consumerPromise;
      }
      return eventStore;
    };

    for (const type of ['inline', 'async'] as const) {
      void it(
        `${type} projection gets the store's database`,
        withDeadline,
        async () => {
          const seen: InMemoryProjectionHandlerContext[] = [];

          const eventStore = await runProjection(type, seen);

          assertThatArray(seen).isNotEmpty();
          for (const context of seen)
            assertEqual(context.database, eventStore.database);
        },
      );

      void it(
        `${type} projection has no eventStore in its context`,
        withDeadline,
        async () => {
          const seen: InMemoryProjectionHandlerContext[] = [];

          await runProjection(type, seen);

          assertThatArray(seen).isNotEmpty();
          for (const context of seen) assertFalse('eventStore' in context);
        },
      );
    }

    void it('projection context type has no eventStore', () => {
      expectTypeOf<InMemoryProjectionHandlerContext>().not.toHaveProperty(
        'eventStore',
      );
    });
  });

  void it(
    `an async projection's checkpoint is in the store's database`,
    withDeadline,
    async () => {
      const eventStore = getInMemoryEventStore({
        projections: projections.async([
          guestSummaryProjection('asyncSummaries'),
        ]),
      });
      const consumer = eventStore.consumer({ includeAsyncProjections: true });
      const { streamName, events } = guestStay();

      const consumerPromise = consumer.start();
      try {
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          events,
        );
        await consumer.whenCaughtUp();

        const processorId = getProjectorId({
          projectionName: 'asyncSummaries',
        });
        const checkpoint = await eventStore.database
          .collection<CheckpointDocument>('emt_processor_checkpoints')
          .findOne((d) => d._id === processorId);
        assertDeepEqual(checkpoint, {
          _id: processorId,
          lastCheckpoint: lastEventGlobalPosition,
          _version: 1n,
        });
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );
});
