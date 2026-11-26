import { testObservabilityContextGenerator } from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { describe, expectTypeOf, it } from 'vitest';
import { inMemoryMessageSource } from '../../consumers';
import type { MessageSource } from '../../consumers';
import { getInMemoryDatabase, type InMemoryDatabase } from '../../database';
import {
  bigIntProcessorCheckpoint,
  inMemoryReactor,
  reactor,
} from '../../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
} from '../../testing';
import type {
  AnyMessage,
  Event,
  ReadEventMetadataWithGlobalPosition,
  RecordedMessage,
} from '../../typing';
import { workflowStreamName } from '../../workflows';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type InitiateGroupCheckout,
  workflowOptions,
} from '../../workflows/workflow.testHelpers';
import type { EventStore } from '../eventStore';
import { getInMemoryEventStore } from '../inMemoryEventStore';
import { inMemorySingleStreamProjection } from '../projections';
import { inMemoryEventStoreConsumer } from './inMemoryEventStoreConsumer';

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;
type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type CheckpointDocument = {
  _id: string;
  lastCheckpoint: string | null;
  _version?: bigint;
};

const recorded = <MessageType extends AnyMessage>(
  message: MessageType,
  streamName: string,
  globalPosition: bigint,
): RecordedMessage<MessageType, ReadEventMetadataWithGlobalPosition> =>
  ({
    ...message,
    kind: message.kind ?? 'Event',
    metadata: {
      checkpoint: bigIntProcessorCheckpoint(globalPosition),
      globalPosition: bigIntProcessorCheckpoint(globalPosition),
      streamName,
      streamPosition: globalPosition,
      messageId: uuid(),
    },
  }) as unknown as RecordedMessage<
    MessageType,
    ReadEventMetadataWithGlobalPosition
  >;

const checkpointIn = (database: InMemoryDatabase, processorId: string) =>
  database
    .collection<CheckpointDocument>('emt_processor_checkpoints')
    .findOne((d) => d._id === processorId);

void describe('In-memory event store consumer with injected message source', () => {
  const guestId = uuid();
  const streamName = `guestStay-${guestId}`;
  const events: GuestStayEvent[] = [
    { type: 'GuestCheckedIn', data: { guestId } },
    { type: 'GuestCheckedOut', data: { guestId } },
  ];
  const lastCheckpoint = bigIntProcessorCheckpoint(BigInt(events.length));

  const recordedEvents = () =>
    events.map((event, index) =>
      recorded(event, streamName, BigInt(index + 1)),
    );

  const injectedSource = (): {
    source: MessageSource<GuestStayEvent, ReadEventMetadataWithGlobalPosition>;
    closes: () => number;
    messages: RecordedMessage<
      GuestStayEvent,
      ReadEventMetadataWithGlobalPosition
    >[];
  } => {
    let closes = 0;
    const messages = recordedEvents();
    const source = inMemoryMessageSource<
      GuestStayEvent,
      ReadEventMetadataWithGlobalPosition
    >({ messages });

    return {
      source: {
        ...source,
        close: () => {
          closes++;
          return Promise.resolve();
        },
      },
      closes: () => closes,
      messages,
    };
  };

  const storeWithoutDatabase = (): EventStore => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { database, ...store } = getInMemoryEventStore();
    return store;
  };

  void it('creates a not-started consumer', () => {
    const consumer = inMemoryEventStoreConsumer({
      source: injectedSource().source,
      messageStore: getInMemoryEventStore(),
    });

    assertFalse(consumer.isRunning);
  });

  void it('handles messages read from the injected source', async () => {
    const { source, messages } = injectedSource();
    const result: GuestStayEvent[] = [];

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: getInMemoryEventStore(),
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: (event) => {
        result.push(event);
      },
    });

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      assertDeepEqual(result, messages);
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('does NOT close the injected source when consumer is closed', async () => {
    const { source, closes } = injectedSource();

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: getInMemoryEventStore(),
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    await consumer.whenCaughtUp();
    await consumer.close();
    await consumerPromise;

    assertEqual(closes(), 0);
  });

  void it('calls the onClose hook when the consumer is closed', async () => {
    const { source } = injectedSource();
    let hookCalls = 0;

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: getInMemoryEventStore(),
      hooks: {
        onClose: () => {
          hookCalls++;
          return Promise.resolve();
        },
      },
    });
    consumer.reactor<GuestStayEvent>({
      processorId: uuid(),
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    await consumer.whenCaughtUp();
    await consumer.close();
    await consumerPromise;

    assertEqual(hookCalls, 1);
  });

  void it('registers an existing processor through reactor', async () => {
    const { source } = injectedSource();
    const processor = reactor<GuestStayEvent>({
      processorId: uuid(),
      checkpoints: 'DISABLED',
      eachMessage: () => {},
    });
    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: getInMemoryEventStore(),
    });

    const registered = consumer.reactor(processor);

    assertEqual(registered, processor);
    assertEqual(consumer.processors[0], processor);
    await consumer.close();
  });

  void it('requires source and messageStore', () => {
    const createWithoutRequiredOptions = () => {
      // @ts-expect-error source is required
      inMemoryEventStoreConsumer({ messageStore: getInMemoryEventStore() });
      // @ts-expect-error messageStore is required
      inMemoryEventStoreConsumer({ source: injectedSource().source });
    };

    expectTypeOf(createWithoutRequiredOptions).toBeFunction();
  });

  void it('projector uses the message store database for read model and checkpoint', async () => {
    const { source } = injectedSource();
    const messageStore = getInMemoryEventStore();
    const processorId = uuid();

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore,
    });
    consumer.projector<GuestStayEvent>({
      processorId,
      projection: inMemorySingleStreamProjection({
        collectionName: 'guestSummaries',
        canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
        initialState: () => ({ events: 0 }),
        evolve: (document: { events: number }) => ({
          events: document.events + 1,
        }),
      }),
    });

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      const summary = await messageStore.database
        .collection('guestSummaries')
        .findOne((d) => d._id === streamName);
      assertDeepEqual(summary, { _id: streamName, _version: 2n, events: 2 });

      const checkpoint = await checkpointIn(messageStore.database, processorId);
      assertDeepEqual(checkpoint, {
        _id: processorId,
        lastCheckpoint,
        _version: 1n,
      });
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('reactor with its own database keeps it', async () => {
    const { source } = injectedSource();
    const messageStore = getInMemoryEventStore();
    const ownDatabase = getInMemoryDatabase();
    const processorId = uuid();

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore,
    });
    consumer.reactor<GuestStayEvent>({
      processorId,
      connectionOptions: { database: ownDatabase },
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      assertDeepEqual(await checkpointIn(ownDatabase, processorId), {
        _id: processorId,
        lastCheckpoint,
        _version: 1n,
      });
      assertEqual(await checkpointIn(messageStore.database, processorId), null);
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('non in-memory messageStore leaves reactors on their own fresh database', async () => {
    const { source } = injectedSource();
    const processorId = uuid();

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: storeWithoutDatabase(),
    });
    const processor = consumer.reactor<GuestStayEvent>({
      processorId,
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      assertDeepEqual(await checkpointIn(processor.database, processorId), {
        _id: processorId,
        lastCheckpoint,
        _version: 1n,
      });
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('built processor keeps its own storage and sees the session message store', async () => {
    const { source, messages } = injectedSource();
    const forwardedMessageIds = [uuid(), uuid()];
    const correlationId = uuid();
    const traceId = uuid();
    const spanId = uuid();
    const messageStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: uuid(),
          spanIds: uuid(),
          messageIds: forwardedMessageIds,
        }),
      },
    });
    const processorId = uuid();
    const forwardedStreamName = `forwarded-${uuid()}`;

    const processor = inMemoryReactor<GuestStayEvent>({
      processorId,
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: traceId,
          spanIds: spanId,
          correlationIds: correlationId,
        }),
      },
      eachMessage: async (event, context) => {
        await context.session.messageStore.appendToStream(forwardedStreamName, [
          { type: event.type, data: event.data },
        ]);
      },
    });
    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore,
    });
    consumer.reactor(processor);

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      assertDeepEqual(await checkpointIn(processor.database, processorId), {
        _id: processorId,
        lastCheckpoint,
        _version: 1n,
      });
      assertEqual(await checkpointIn(messageStore.database, processorId), null);

      const { events: forwarded } =
        await messageStore.readStream<GuestStayEvent>(forwardedStreamName);
      assertDeepEqual(
        forwarded,
        events.map((event, index) => {
          const position = BigInt(index + 1);
          return {
            ...event,
            kind: 'Event' as const,
            schemaVersion: 1 as const,
            metadata: {
              streamName: forwardedStreamName,
              messageId: forwardedMessageIds[index]!,
              streamPosition: position,
              globalPosition: bigIntProcessorCheckpoint(position),
              checkpoint: bigIntProcessorCheckpoint(position),
              correlationId,
              causationId: messages[index]!.metadata.messageId,
              traceId,
              spanId,
            },
          };
        }),
      );
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void it('treats a message store with a database member as an in-memory store', async () => {
    const { source } = injectedSource();
    const database = getInMemoryDatabase();
    const processorId = uuid();

    const consumer = inMemoryEventStoreConsumer<GuestStayEvent>({
      source,
      messageStore: { ...storeWithoutDatabase(), database } as EventStore,
    });
    consumer.reactor<GuestStayEvent>({
      processorId,
      eachMessage: () => {},
    });

    const consumerPromise = consumer.start();
    try {
      await consumer.whenCaughtUp();

      assertDeepEqual(await checkpointIn(database, processorId), {
        _id: processorId,
        lastCheckpoint,
        _version: 1n,
      });
    } finally {
      await consumer.close();
      await consumerPromise;
    }
  });

  void describe('workflow processor', () => {
    const groupCheckoutId = uuid();
    const guestStayAccountId = uuid();
    const now = new Date();
    const initiate: InitiateGroupCheckout = {
      type: 'InitiateGroupCheckout',
      kind: 'Command',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds: [guestStayAccountId],
        now,
      },
    };

    const workflowInput = () =>
      recorded(initiate, `groupCheckout-${groupCheckoutId}`, 1n);

    const workflowSource = (
      input: RecordedMessage<
        InitiateGroupCheckout,
        ReadEventMetadataWithGlobalPosition
      > = workflowInput(),
    ) =>
      inMemoryMessageSource<
        GroupCheckoutInput | GroupCheckoutOutput,
        ReadEventMetadataWithGlobalPosition
      >({ messages: [input] });

    void it('workflow output goes to the given message store', async () => {
      const outputMessageIds = [uuid(), uuid(), uuid()];
      const correlationId = uuid();
      const traceId = uuid();
      const spanId = uuid();
      const messageStore = getInMemoryEventStore({
        observability: {
          contextGenerator: testObservabilityContextGenerator({
            traceIds: uuid(),
            spanIds: uuid(),
            messageIds: outputMessageIds,
          }),
        },
      });
      const input = workflowInput();
      const consumer = inMemoryEventStoreConsumer({
        source: workflowSource(input),
        messageStore,
      });
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowOptions,
        processorId: uuid(),
        observability: {
          contextGenerator: testObservabilityContextGenerator({
            traceIds: traceId,
            spanIds: spanId,
            correlationIds: correlationId,
          }),
        },
      });

      const consumerPromise = consumer.start();
      try {
        await consumer.whenCaughtUp();

        const workflowStream = workflowStreamName({
          workflowName: GroupCheckoutWorkflow.name,
          workflowId: groupCheckoutId,
        });
        const { events: output } =
          await messageStore.readStream(workflowStream);

        const stored = (
          index: number,
          type: string,
          kind: 'Command' | 'Event',
          data: unknown,
          metadata: Record<string, unknown>,
        ) => {
          const position = BigInt(index + 1);
          return {
            type,
            data,
            kind,
            schemaVersion: 1,
            metadata: {
              ...metadata,
              streamName: workflowStream,
              messageId: outputMessageIds[index],
              streamPosition: position,
              globalPosition: bigIntProcessorCheckpoint(position),
              checkpoint: bigIntProcessorCheckpoint(position),
              correlationId,
              causationId: input.metadata.messageId,
              traceId,
              spanId,
            },
          };
        };

        assertDeepEqual<unknown>(output, [
          stored(
            0,
            'GroupCheckoutWorkflow:InitiateGroupCheckout',
            'Command',
            initiate.data,
            {
              originalMessageId: input.metadata.messageId,
              input: true,
              action: 'InitiatedBy',
            },
          ),
          stored(
            1,
            'GroupCheckoutInitiated',
            'Event',
            {
              groupCheckoutId,
              guestStayAccountIds: [guestStayAccountId],
              initiatedAt: now,
              clerkId: 'clerk-1',
            },
            { action: 'Published' },
          ),
          stored(
            2,
            'CheckOut',
            'Command',
            { guestStayAccountId, groupCheckoutId },
            { now, action: 'Sent' },
          ),
        ]);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    });

    void it('workflow checkpoint is in messageStore.database', async () => {
      const messageStore = getInMemoryEventStore();
      const processorId = uuid();
      const consumer = inMemoryEventStoreConsumer({
        source: workflowSource(),
        messageStore,
      });
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({ ...workflowOptions, processorId });

      const consumerPromise = consumer.start();
      try {
        await consumer.whenCaughtUp();

        const checkpoint = await checkpointIn(
          messageStore.database,
          processorId,
        );
        assertOk(checkpoint);
        assertDeepEqual(checkpoint, {
          _id: processorId,
          lastCheckpoint: bigIntProcessorCheckpoint(1n),
          _version: 1n,
        });
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    });
  });
});
