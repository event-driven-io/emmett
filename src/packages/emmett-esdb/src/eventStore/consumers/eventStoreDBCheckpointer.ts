import {
  ProcessorCheckpoint,
  defaultProcessorPartition,
  getCheckpoint,
  type AnyMessage,
  type AnyReadEventMetadata,
  type Checkpointer,
  type DefaultRecord,
  type ReadProcessorCheckpointResult,
  type StoreProcessorCheckpointResult,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  ANY,
  BACKWARDS,
  END,
  NO_STREAM,
  StreamNotFoundError,
  WrongExpectedVersionError,
  jsonEvent,
} from '@eventstore/db-client';

const CheckpointStoredEventType = '$EmmettProcessorCheckpointStored';

export type EventStoreDBCheckpointStored = {
  subscriptionId: string;
  position: ProcessorCheckpoint | null;
  checkpointedAt: string;
};

type EventStoreDBCheckpointStoredEvent = {
  type: typeof CheckpointStoredEventType;
  data: EventStoreDBCheckpointStored;
};

export type EventStoreDBStoredProcessorCheckpoint =
  ReadProcessorCheckpointResult & {
    storeRevision: bigint | null;
  };

export type EventStoreDBStoreProcessorCheckpointResult =
  | {
      success: true;
      newCheckpoint: ProcessorCheckpoint | null;
      storeRevision: bigint;
    }
  | { success: false; reason: 'MISMATCH' };

type EventStoreDBProcessorCheckpointOptions = {
  processorId: string;
  partition?: string;
};

type EventStoreDBCheckpointerContext = DefaultRecord & {
  client: EventStoreDBClient;
};

const getEventStoreDBCheckpointSubscriptionId = ({
  processorId,
  partition = defaultProcessorPartition,
}: EventStoreDBProcessorCheckpointOptions): string =>
  partition === defaultProcessorPartition
    ? processorId
    : `${processorId}:${partition}`;

export const getEventStoreDBCheckpointStreamName = (
  options: EventStoreDBProcessorCheckpointOptions,
): string => `checkpoint_${getEventStoreDBCheckpointSubscriptionId(options)}`;

const checkpointStored = (
  subscriptionId: string,
  position: ProcessorCheckpoint | null,
) =>
  jsonEvent<EventStoreDBCheckpointStoredEvent>({
    type: CheckpointStoredEventType,
    data: {
      subscriptionId,
      position,
      checkpointedAt: new Date().toISOString(),
    },
  });

export const readEventStoreDBProcessorCheckpoint = async (
  client: EventStoreDBClient,
  options: EventStoreDBProcessorCheckpointOptions,
): Promise<EventStoreDBStoredProcessorCheckpoint> => {
  const streamName = getEventStoreDBCheckpointStreamName(options);

  try {
    const stream = client.readStream<EventStoreDBCheckpointStoredEvent>(
      streamName,
      {
        direction: BACKWARDS,
        fromRevision: END,
        maxCount: 1,
      },
    );

    for await (const resolvedEvent of stream) {
      if (!resolvedEvent.event) continue;

      const { position } = resolvedEvent.event.data;

      return {
        lastCheckpoint:
          position === null ? null : ProcessorCheckpoint(position),
        storeRevision: resolvedEvent.event.revision,
      };
    }
  } catch (error) {
    if (error instanceof StreamNotFoundError)
      return { lastCheckpoint: null, storeRevision: null };

    throw error;
  }

  throw new Error(`Didn't find checkpoint in stream '${streamName}'`);
};

export const storeEventStoreDBProcessorCheckpoint = async (
  client: EventStoreDBClient,
  options: EventStoreDBProcessorCheckpointOptions & {
    newCheckpoint: ProcessorCheckpoint | null;
    previousCheckpoint: EventStoreDBStoredProcessorCheckpoint;
  },
): Promise<EventStoreDBStoreProcessorCheckpointResult> => {
  const subscriptionId = getEventStoreDBCheckpointSubscriptionId(options);
  const streamName = getEventStoreDBCheckpointStreamName(options);

  if (options.previousCheckpoint.storeRevision === null) {
    await client.setStreamMetadata(
      streamName,
      { maxCount: 1 },
      {
        // Metadata and event appends are not transactional. ANY makes retrying
        // safe if metadata succeeds but the first checkpoint append fails.
        expectedRevision: ANY,
      },
    );
  }

  try {
    const result = await client.appendToStream(
      streamName,
      checkpointStored(subscriptionId, options.newCheckpoint),
      {
        expectedRevision: options.previousCheckpoint.storeRevision ?? NO_STREAM,
      },
    );

    return {
      success: true,
      newCheckpoint: options.newCheckpoint,
      storeRevision: result.nextExpectedRevision,
    };
  } catch (error) {
    if (error instanceof WrongExpectedVersionError)
      return { success: false, reason: 'MISMATCH' };

    throw error;
  }
};

export const resetEventStoreDBProcessorCheckpoint = async (
  client: EventStoreDBClient,
  options: EventStoreDBProcessorCheckpointOptions,
): Promise<EventStoreDBStoredProcessorCheckpoint> => {
  const subscriptionId = getEventStoreDBCheckpointSubscriptionId(options);
  const result = await client.appendToStream(
    getEventStoreDBCheckpointStreamName(options),
    checkpointStored(subscriptionId, null),
    { expectedRevision: ANY },
  );

  return {
    lastCheckpoint: null,
    storeRevision: result.nextExpectedRevision,
  };
};

export type EventStoreDBCheckpointer<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends EventStoreDBCheckpointerContext =
    EventStoreDBCheckpointerContext,
> = Checkpointer<MessageType, MessageMetadataType, HandlerContext> & {
  reset: (
    options: EventStoreDBProcessorCheckpointOptions,
    context: HandlerContext,
  ) => Promise<ReadProcessorCheckpointResult>;
};

export const eventStoreDBCheckpointer = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends EventStoreDBCheckpointerContext =
    EventStoreDBCheckpointerContext,
>(): EventStoreDBCheckpointer<
  MessageType,
  MessageMetadataType,
  HandlerContext
> => {
  const checkpoints = new Map<string, EventStoreDBStoredProcessorCheckpoint>();

  return {
    read: async (options, context) => {
      const checkpoint = await readEventStoreDBProcessorCheckpoint(
        context.client,
        options,
      );

      checkpoints.set(getEventStoreDBCheckpointStreamName(options), checkpoint);

      return { lastCheckpoint: checkpoint.lastCheckpoint };
    },
    store: async (
      options,
      context,
    ): Promise<StoreProcessorCheckpointResult> => {
      const streamName = getEventStoreDBCheckpointStreamName(options);
      let previousCheckpoint = checkpoints.get(streamName);

      if (!previousCheckpoint) {
        previousCheckpoint = await readEventStoreDBProcessorCheckpoint(
          context.client,
          options,
        );
      }

      if (previousCheckpoint.lastCheckpoint !== options.lastCheckpoint)
        return { success: false, reason: 'MISMATCH' };

      const result = await storeEventStoreDBProcessorCheckpoint(
        context.client,
        {
          ...options,
          newCheckpoint: getCheckpoint(options.message),
          previousCheckpoint,
        },
      );

      if (!result.success) return result;

      checkpoints.set(streamName, {
        lastCheckpoint: result.newCheckpoint,
        storeRevision: result.storeRevision,
      });

      return { success: true, newCheckpoint: result.newCheckpoint };
    },
    reset: async (options, context) => {
      const checkpoint = await resetEventStoreDBProcessorCheckpoint(
        context.client,
        options,
      );

      checkpoints.set(getEventStoreDBCheckpointStreamName(options), checkpoint);

      return { lastCheckpoint: checkpoint.lastCheckpoint };
    },
  };
};
