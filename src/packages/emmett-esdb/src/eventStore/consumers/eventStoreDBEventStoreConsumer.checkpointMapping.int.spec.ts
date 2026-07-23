import {
  assertEqual,
  asyncRetry,
  bigIntProcessorCheckpoint,
  type Event,
} from '@event-driven-io/emmett';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { BACKWARDS, END, type ResolvedEvent } from '@eventstore/db-client';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  getEventStoreDBEventStore,
  mapFromESDBEvent,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import { $all } from './eventStoreDBEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('EventStoreDB checkpoint mapping', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let eventStore: EventStoreDBEventStore;

  beforeAll(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    eventStore = getEventStoreDBEventStore(eventStoreDB.getClient());
  });

  afterAll(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const readLastFromAll = async (
    streamName: string,
  ): Promise<ResolvedEvent<GuestStayEvent>> => {
    const stream = eventStoreDB.getClient().readAll({
      direction: BACKWARDS,
      fromPosition: END,
      resolveLinkTos: false,
    });

    for await (const resolvedEvent of stream) {
      if (resolvedEvent.event?.streamId === streamName)
        return resolvedEvent as ResolvedEvent<GuestStayEvent>;
    }

    throw new Error(`Expected to read event from ${streamName} in $all`);
  };

  const readLastFromProjection = async (
    projectionStreamName: string,
    streamName: string,
  ): Promise<ResolvedEvent<GuestStayEvent>> =>
    asyncRetry(
      async () => {
        const stream = eventStoreDB
          .getClient()
          .readStream<GuestStayEvent>(projectionStreamName, {
            direction: BACKWARDS,
            fromRevision: END,
            resolveLinkTos: true,
          });

        for await (const resolvedEvent of stream) {
          if (resolvedEvent.event?.streamId === streamName)
            return resolvedEvent;
        }

        throw new Error(
          `Expected to read event from ${streamName} in ${projectionStreamName}`,
        );
      },
      {
        retries: 100,
        minTimeout: 50,
        factor: 1,
      },
    );

  void it(
    'maps $all checkpoint to resumable global commit position',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];
      const appendResult = await eventStore.appendToStream(streamName, events);

      const resolvedEvent = await readLastFromAll(streamName);
      const mapped = mapFromESDBEvent<GuestStayEvent>(resolvedEvent, {
        stream: $all,
      });

      assertEqual(
        mapped.metadata.checkpoint,
        appendResult.lastEventGlobalPosition,
      );
      assertEqual(
        mapped.metadata.globalPosition,
        appendResult.lastEventGlobalPosition,
      );
    },
  );

  void it(
    'maps category checkpoint to resumable category revision and keeps original global position',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];
      await eventStore.appendToStream(streamName, events);

      const resolvedEvent = await readLastFromProjection(
        '$ce-guestStay',
        streamName,
      );
      const mapped = mapFromESDBEvent<GuestStayEvent>(resolvedEvent, {
        stream: '$ce-guestStay',
        options: { resolveLinkTos: true },
      });

      assertEqual(
        mapped.metadata.checkpoint,
        bigIntProcessorCheckpoint(resolvedEvent.link!.revision),
      );
      assertEqual(
        mapped.metadata.globalPosition,
        bigIntProcessorCheckpoint(resolvedEvent.event!.position!.commit),
      );
      assertEqual(mapped.metadata.streamName, streamName);
    },
  );

  void it(
    'maps event type projection checkpoint to resumable projection revision and keeps original global position',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];
      await eventStore.appendToStream(streamName, events);

      const resolvedEvent = await readLastFromProjection(
        '$et-GuestCheckedOut',
        streamName,
      );
      const mapped = mapFromESDBEvent<GuestStayEvent>(resolvedEvent, {
        stream: '$et-GuestCheckedOut',
        options: { resolveLinkTos: true },
      });

      assertEqual(
        mapped.metadata.checkpoint,
        bigIntProcessorCheckpoint(resolvedEvent.link!.revision),
      );
      assertEqual(
        mapped.metadata.globalPosition,
        bigIntProcessorCheckpoint(resolvedEvent.event!.position!.commit),
      );
      assertEqual(mapped.metadata.streamName, streamName);
      assertEqual(mapped.type, 'GuestCheckedOut');
    },
  );

  void it(
    'maps regular stream checkpoint to resumable stream revision and keeps global position when available',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];
      const appendResult = await eventStore.appendToStream(streamName, events);

      const stream = eventStoreDB
        .getClient()
        .readStream<GuestStayEvent>(streamName, {
          direction: BACKWARDS,
          fromRevision: END,
          maxCount: 1,
        });

      for await (const resolvedEvent of stream) {
        const mapped = mapFromESDBEvent<GuestStayEvent>(resolvedEvent, {
          stream: streamName,
        });

        assertEqual(
          mapped.metadata.checkpoint,
          bigIntProcessorCheckpoint(appendResult.nextExpectedStreamVersion),
        );
        assertEqual(
          mapped.metadata.globalPosition,
          appendResult.lastEventGlobalPosition,
        );
        assertEqual(
          mapped.metadata.streamPosition,
          appendResult.nextExpectedStreamVersion,
        );
        return;
      }

      throw new Error(`Expected to read event from ${streamName}`);
    },
  );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
