import { v4 as uuid } from 'uuid';
import { beforeEach, describe, it } from 'vitest';
import { bigIntProcessorCheckpoint, inMemoryReactor } from '../../processors';
import { assertDeepEqual, assertNotEqual, assertOk } from '../../testing';
import type { Event } from '../../typing';
import {
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '../inMemoryEventStore';

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestWelcomed = Event<'GuestWelcomed', { guestId: string }>;

const withDeadline = { timeout: 30000 };

void describe('In-memory event store consumer message store', () => {
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
  });

  const guestCheckedIn = () => {
    const guestId = uuid();
    const event: GuestCheckedIn = { type: 'GuestCheckedIn', data: { guestId } };
    return { guestId, streamName: `guestStay-${guestId}`, event };
  };

  const assertWelcomed = async (
    streamName: string,
    welcomeStreamName: string,
    guestId: string,
  ) => {
    const {
      events: [handled],
    } = await eventStore.readStream<GuestCheckedIn>(streamName);
    const { events } =
      await eventStore.readStream<GuestWelcomed>(welcomeStreamName);
    assertOk(handled);
    assertDeepEqual(
      events.map(({ type, kind, schemaVersion, data, metadata }) => ({
        type,
        kind,
        schemaVersion,
        data,
        streamName: metadata.streamName,
        streamPosition: metadata.streamPosition,
        globalPosition: metadata.globalPosition,
        checkpoint: metadata.checkpoint,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId,
      })),
      [
        {
          type: 'GuestWelcomed',
          kind: 'Event',
          schemaVersion: 1,
          data: { guestId },
          streamName: welcomeStreamName,
          streamPosition: 1n,
          globalPosition: bigIntProcessorCheckpoint(2n),
          checkpoint: bigIntProcessorCheckpoint(2n),
          correlationId: handled.metadata.correlationId,
          causationId: handled.metadata.messageId,
        },
      ],
    );
  };

  void it(
    `reactor appends through the session's message store`,
    withDeadline,
    async () => {
      const consumer = eventStore.consumer();
      const { guestId, streamName, event } = guestCheckedIn();
      const welcomeStreamName = `welcome-${guestId}`;
      consumer.reactor<GuestCheckedIn>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          const messageStore = context.session.messageStore;
          await messageStore.appendToStream(welcomeStreamName, [
            {
              type: 'GuestWelcomed',
              data: { guestId: message.data.guestId },
            },
          ]);
        },
      });

      const consumerPromise = consumer.start();
      try {
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [event],
        );
        await consumer.whenProcessed(lastEventGlobalPosition);

        await assertWelcomed(streamName, welcomeStreamName, guestId);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );

  void it(
    'reactor appends continue the handled message flow',
    withDeadline,
    async () => {
      const consumer = eventStore.consumer();
      const { guestId, streamName, event } = guestCheckedIn();
      const welcomeStreamName = `welcome-${guestId}`;
      consumer.reactor<GuestCheckedIn>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          const messageStore = context.session.messageStore;
          await messageStore.appendToStream(welcomeStreamName, [
            {
              type: 'GuestWelcomed',
              data: { guestId: message.data.guestId },
            },
          ]);
        },
      });

      const consumerPromise = consumer.start();
      try {
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [event],
        );
        await consumer.whenProcessed(lastEventGlobalPosition);

        const {
          events: [handled],
        } = await eventStore.readStream<GuestCheckedIn>(streamName);
        const {
          events: [appended],
        } = await eventStore.readStream<GuestWelcomed>(welcomeStreamName);
        assertOk(handled);
        assertOk(appended);
        assertOk(handled.metadata.correlationId);
        assertNotEqual(appended.metadata.messageId, handled.metadata.messageId);
        assertDeepEqual(
          {
            correlationId: appended.metadata.correlationId,
            causationId: appended.metadata.causationId,
          },
          {
            correlationId: handled.metadata.correlationId,
            causationId: handled.metadata.messageId,
          },
        );
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );

  void it(
    `built inMemoryReactor passed to consumer.reactor appends through the session's message store`,
    withDeadline,
    async () => {
      const consumer = eventStore.consumer();
      const { guestId, streamName, event } = guestCheckedIn();
      const welcomeStreamName = `welcome-${guestId}`;
      const reactor = inMemoryReactor<GuestCheckedIn>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          const messageStore = context.session.messageStore;
          await messageStore.appendToStream(welcomeStreamName, [
            {
              type: 'GuestWelcomed',
              data: { guestId: message.data.guestId },
            },
          ]);
        },
      });
      consumer.reactor(reactor);

      const consumerPromise = consumer.start();
      try {
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [event],
        );
        await consumer.whenProcessed(lastEventGlobalPosition);

        await assertWelcomed(streamName, welcomeStreamName, guestId);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );
});
