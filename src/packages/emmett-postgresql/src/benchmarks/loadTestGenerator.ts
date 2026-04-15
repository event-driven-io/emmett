import { randomUUID } from 'node:crypto';

export type LoadTestConfig = {
  totalEvents: number;
  streamTypes: number;
  maxStreamLength: number;
  batchSize: number;
  partitions: number;
};

export type LoadTestPartitionConfig = {
  partitionIndex: number;
  events: number;
  streamTypes: number;
  maxStreamLength: number;
  batchSize: number;
};

export type EventGenerationContext = {
  streamTypeIndex: number;
  streamName: string;
  streamPosition: number;
  eventsEmitted: number;
};

export type EventDefinition = { type: string; data: unknown };

export type EventGenerator = (ctx: EventGenerationContext) => EventDefinition;

export type GeneratedBatch = {
  streamTypeIndex: number;
  streamName: string;
  events: EventDefinition[];
};

export type MessageBatchAppender = {
  append: (batch: GeneratedBatch) => Promise<void>;
};

export function partitionConfig(
  config: LoadTestConfig,
): LoadTestPartitionConfig[] {
  const { partitions, totalEvents, streamTypes, maxStreamLength, batchSize } =
    config;
  const base = Math.floor(totalEvents / partitions);
  const remainder = totalEvents % partitions;

  return Array.from({ length: partitions }, (_, i) => ({
    partitionIndex: i,
    events: base + (i === partitions - 1 ? remainder : 0),
    streamTypes,
    maxStreamLength,
    batchSize,
  }));
}

export function* generateBatches(
  partition: LoadTestPartitionConfig,
  generateEvent: EventGenerator,
): Generator<GeneratedBatch> {
  const { partitionIndex, streamTypes, maxStreamLength, batchSize } = partition;

  type StreamSlot = { streamName: string; streamPosition: number };
  const openStreams: (StreamSlot | undefined)[] = Array.from(
    { length: streamTypes },
    () => undefined,
  );

  let eventsLeft = partition.events;
  let eventsEmitted = 0;

  while (eventsLeft > 0) {
    const streamTypeIndex = eventsEmitted % streamTypes;

    if (openStreams[streamTypeIndex] === undefined) {
      openStreams[streamTypeIndex] = {
        streamName: `st${streamTypeIndex}-p${partitionIndex}-${randomUUID()}`,
        streamPosition: 0,
      };
    }

    const slot = openStreams[streamTypeIndex];
    if (slot === undefined) continue;
    const { streamName, streamPosition } = slot;

    const size = Math.min(
      batchSize,
      maxStreamLength - streamPosition,
      eventsLeft,
    );

    const events: EventDefinition[] = [];
    for (let i = 0; i < size; i++) {
      events.push(
        generateEvent({
          streamTypeIndex,
          streamName,
          streamPosition: streamPosition + i,
          eventsEmitted: eventsEmitted + i,
        }),
      );
    }

    yield { streamTypeIndex, streamName, events };

    slot.streamPosition += size;
    eventsLeft -= size;
    eventsEmitted += size;

    if (slot.streamPosition >= maxStreamLength) {
      openStreams[streamTypeIndex] = undefined;
    }
  }
}

export async function runLoadTest(
  config: LoadTestConfig,
  generateEvent: EventGenerator,
  appender: MessageBatchAppender,
): Promise<void> {
  await Promise.all(
    partitionConfig(config).map(async (partition) => {
      for (const batch of generateBatches(partition, generateEvent)) {
        await appender.append(batch);
      }
    }),
  );
}
