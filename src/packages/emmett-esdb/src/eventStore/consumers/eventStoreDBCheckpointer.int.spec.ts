import {
  ProcessorCheckpoint,
  assertDeepEqual,
  assertEqual,
  type Event,
  type ReadEventMetadataWithGlobalPosition,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import { beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { getSharedEventStoreDB } from '../../testing/sharedEventStoreDB';
import {
  eventStoreDBCheckpointer,
  getEventStoreDBCheckpointStreamName,
  readEventStoreDBProcessorCheckpoint,
  resetEventStoreDBProcessorCheckpoint,
  storeEventStoreDBProcessorCheckpoint,
} from './eventStoreDBCheckpointer';

void describe('EventStoreDB processor checkpointer', () => {
  let client: EventStoreDBClient;

  beforeAll(() => {
    client = getSharedEventStoreDB().getClient();
  });

  void it('reads no checkpoint when the checkpoint stream does not exist', async () => {
    const checkpoint = await readEventStoreDBProcessorCheckpoint(client, {
      processorId: uuid(),
    });

    assertDeepEqual(checkpoint, {
      lastCheckpoint: null,
      storeRevision: null,
    });
  });

  void it('stores and reads checkpoints using the stream revision for concurrency', async () => {
    const processorId = uuid();
    const firstPosition = ProcessorCheckpoint('10');
    const secondPosition = ProcessorCheckpoint('20');
    const initial = await readEventStoreDBProcessorCheckpoint(client, {
      processorId,
    });

    const firstStore = await storeEventStoreDBProcessorCheckpoint(client, {
      processorId,
      newCheckpoint: firstPosition,
      previousCheckpoint: initial,
    });

    assertDeepEqual(firstStore, {
      success: true,
      newCheckpoint: firstPosition,
      storeRevision: 0n,
    });

    if (!firstStore.success) return;

    const secondStore = await storeEventStoreDBProcessorCheckpoint(client, {
      processorId,
      newCheckpoint: secondPosition,
      previousCheckpoint: {
        lastCheckpoint: firstStore.newCheckpoint,
        storeRevision: firstStore.storeRevision,
      },
    });

    assertDeepEqual(secondStore, {
      success: true,
      newCheckpoint: secondPosition,
      storeRevision: 1n,
    });
    assertDeepEqual(
      await readEventStoreDBProcessorCheckpoint(client, { processorId }),
      {
        lastCheckpoint: secondPosition,
        storeRevision: 1n,
      },
    );

    const streamName = getEventStoreDBCheckpointStreamName({ processorId });
    const metadata = await client.getStreamMetadata(streamName);
    const storedEvents = [];
    for await (const event of client.readStream(streamName))
      storedEvents.push(event);

    assertEqual(metadata.metadata?.maxCount, 1);
    assertEqual(storedEvents.length, 1);
  });

  void it('returns MISMATCH when another checkpointer stores first', async () => {
    const processorId = uuid();
    const initial = await readEventStoreDBProcessorCheckpoint(client, {
      processorId,
    });

    const winner = await storeEventStoreDBProcessorCheckpoint(client, {
      processorId,
      newCheckpoint: ProcessorCheckpoint('10'),
      previousCheckpoint: initial,
    });
    const staleStore = await storeEventStoreDBProcessorCheckpoint(client, {
      processorId,
      newCheckpoint: ProcessorCheckpoint('20'),
      previousCheckpoint: initial,
    });

    assertEqual(winner.success, true);
    assertDeepEqual(staleStore, { success: false, reason: 'MISMATCH' });
  });

  void it('retains the stream revision when resetting to a null checkpoint', async () => {
    const processorId = uuid();
    const initial = await readEventStoreDBProcessorCheckpoint(client, {
      processorId,
    });
    const stored = await storeEventStoreDBProcessorCheckpoint(client, {
      processorId,
      newCheckpoint: ProcessorCheckpoint('10'),
      previousCheckpoint: initial,
    });

    assertEqual(stored.success, true);

    const reset = await resetEventStoreDBProcessorCheckpoint(client, {
      processorId,
    });

    assertDeepEqual(reset, {
      lastCheckpoint: null,
      storeRevision: 1n,
    });
    assertDeepEqual(
      await readEventStoreDBProcessorCheckpoint(client, { processorId }),
      reset,
    );

    const storedAfterReset = await storeEventStoreDBProcessorCheckpoint(
      client,
      {
        processorId,
        newCheckpoint: ProcessorCheckpoint('30'),
        previousCheckpoint: reset,
      },
    );

    assertDeepEqual(storedAfterReset, {
      success: true,
      newCheckpoint: ProcessorCheckpoint('30'),
      storeRevision: 2n,
    });
  });

  void it('stores checkpoints independently for each processor partition', async () => {
    const processorId = uuid();
    const firstPartition = { processorId, partition: 'first' };
    const secondPartition = { processorId, partition: 'second' };

    const firstStore = await storeEventStoreDBProcessorCheckpoint(client, {
      ...firstPartition,
      newCheckpoint: ProcessorCheckpoint('10'),
      previousCheckpoint: await readEventStoreDBProcessorCheckpoint(
        client,
        firstPartition,
      ),
    });
    const secondStore = await storeEventStoreDBProcessorCheckpoint(client, {
      ...secondPartition,
      newCheckpoint: ProcessorCheckpoint('20'),
      previousCheckpoint: await readEventStoreDBProcessorCheckpoint(
        client,
        secondPartition,
      ),
    });

    assertEqual(firstStore.success, true);
    assertEqual(secondStore.success, true);
    assertEqual(
      (await readEventStoreDBProcessorCheckpoint(client, firstPartition))
        .lastCheckpoint,
      ProcessorCheckpoint('10'),
    );
    assertEqual(
      (await readEventStoreDBProcessorCheckpoint(client, secondPartition))
        .lastCheckpoint,
      ProcessorCheckpoint('20'),
    );
  });

  void it('resumes from a checkpoint stored by another checkpointer instance', async () => {
    type TestEvent = Event<'TestEvent', Record<string, never>>;

    const processorId = uuid();
    const checkpoint = ProcessorCheckpoint('10');
    const firstCheckpointer = eventStoreDBCheckpointer<
      TestEvent,
      ReadEventMetadataWithGlobalPosition
    >();
    const secondCheckpointer = eventStoreDBCheckpointer<
      TestEvent,
      ReadEventMetadataWithGlobalPosition
    >();
    const message: RecordedMessage<
      TestEvent,
      ReadEventMetadataWithGlobalPosition
    > = {
      kind: 'Event',
      type: 'TestEvent',
      data: {},
      metadata: {
        messageId: uuid(),
        streamName: `test-${uuid()}`,
        streamPosition: 0n,
        globalPosition: checkpoint,
        checkpoint,
      },
    };

    const initial = await firstCheckpointer.read({ processorId }, { client });
    const stored = await firstCheckpointer.store(
      {
        processorId,
        version: 1,
        message,
        lastCheckpoint: initial.lastCheckpoint,
      },
      { client },
    );

    assertDeepEqual(stored, { success: true, newCheckpoint: checkpoint });
    assertDeepEqual(
      await secondCheckpointer.read({ processorId }, { client }),
      { lastCheckpoint: checkpoint },
    );
  });
});
