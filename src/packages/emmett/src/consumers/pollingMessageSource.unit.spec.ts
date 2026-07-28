import { describe, it } from 'vitest';
import { isGlobalStreamCaughtUp } from '../eventStore/events';
import { ProcessorCheckpoint } from '../processors';
import { assertDeepEqual, assertEqual, assertTrue } from '../testing';
import type { AnyMessage, Event, RecordedMessage } from '../typing';
import {
  DefaultPollingBackoffCeilingInMs,
  DefaultPollingInitialBackoffInMs,
  nextPollingWaitTime,
  pollingMessageSource,
  type PollingReadBatchOptions,
  type PollingReadBatchResult,
} from './pollingMessageSource';

const messageAt = (checkpoint: string): RecordedMessage =>
  ({
    type: 'Tested',
    data: {},
    metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

const scriptedReads = (
  results: {
    checkpoints: string[];
    areMessagesLeft?: boolean;
  }[],
) => {
  const calls: PollingReadBatchOptions[] = [];
  let index = 0;

  return {
    calls,
    // eslint-disable-next-line @typescript-eslint/require-await
    readBatch: async (
      options: PollingReadBatchOptions,
    ): Promise<PollingReadBatchResult<AnyMessage, never>> => {
      calls.push(options);
      const result = results[index++] ?? { checkpoints: [] };
      const last = result.checkpoints[result.checkpoints.length - 1];

      return {
        messages: result.checkpoints.map(
          messageAt,
        ) as unknown as RecordedMessage<AnyMessage, never>[],
        currentCheckpoint:
          last !== undefined ? ProcessorCheckpoint(last) : options.after,
        areMessagesLeft: result.areMessagesLeft ?? index < results.length,
      };
    },
  };
};

const readAll = async (
  source: ReturnType<typeof pollingMessageSource>,
  from: Parameters<typeof source.read>[0]['from'],
  take: number,
) => {
  const controller = new AbortController();
  const batches = [];

  for await (const batch of source.read({ from, signal: controller.signal })) {
    batches.push(batch);
    if (batches.length >= take) controller.abort();
  }

  return batches;
};

void describe('nextPollingWaitTime', () => {
  void it('falls back to the polling frequency while messages keep coming', () => {
    assertEqual(nextPollingWaitTime(800, true, 50), 50);
  });

  void it('doubles the wait while the tail stays empty', () => {
    assertEqual(nextPollingWaitTime(100, false, 50), 200);
    assertEqual(nextPollingWaitTime(200, false, 50), 400);
  });

  void it('never waits longer than the ceiling', () => {
    assertEqual(
      nextPollingWaitTime(DefaultPollingBackoffCeilingInMs, false, 50),
      DefaultPollingBackoffCeilingInMs,
    );
  });
});

void describe('pollingMessageSource', () => {
  void it('starts from no checkpoint when reading from BEGINNING', async () => {
    const reads = scriptedReads([{ checkpoints: ['1'] }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    await readAll(source, 'BEGINNING', 1);

    assertEqual(reads.calls[0]!.after, null);
  });

  void it('resolves END through the last checkpoint', async () => {
    const reads = scriptedReads([{ checkpoints: ['6'] }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(ProcessorCheckpoint('5')),
      pullingFrequencyInMs: 0,
    });

    await readAll(source, 'END', 1);

    assertEqual(reads.calls[0]!.after, ProcessorCheckpoint('5'));
  });

  void it('advances the checkpoint across polls', async () => {
    const reads = scriptedReads([
      { checkpoints: ['1', '2'], areMessagesLeft: true },
      { checkpoints: ['3'], areMessagesLeft: true },
    ]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    const batches = await readAll(
      source,
      { lastCheckpoint: ProcessorCheckpoint('0') },
      2,
    );

    assertEqual(reads.calls[0]!.after, ProcessorCheckpoint('0'));
    assertEqual(reads.calls[1]!.after, ProcessorCheckpoint('2'));
    assertDeepEqual(
      batches.map((b) => b.lastCheckpoint),
      [ProcessorCheckpoint('2'), ProcessorCheckpoint('3')],
    );
  });

  void it('emits a caught up control message once the tail is empty', async () => {
    const reads = scriptedReads([
      { checkpoints: ['1'], areMessagesLeft: false },
    ]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    const batches = await readAll(source, 'BEGINNING', 2);

    assertEqual(batches.length, 2);
    assertTrue(isGlobalStreamCaughtUp(batches[1]!.messages[0]! as Event));
    assertEqual(batches[1]!.lastCheckpoint, ProcessorCheckpoint('1'));
  });

  void it('passes the requested batch size down to the read', async () => {
    const reads = scriptedReads([{ checkpoints: ['1'] }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    const controller = new AbortController();

    for await (const _ of source.read({
      from: 'BEGINNING',
      batchSize: 7,
      signal: controller.signal,
    })) {
      controller.abort();
    }

    assertEqual(reads.calls[0]!.batchSize, 7);
  });

  void it('stops iterating once the signal is aborted mid wait', async () => {
    const reads = scriptedReads([{ checkpoints: [], areMessagesLeft: false }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: DefaultPollingInitialBackoffInMs,
    });

    const controller = new AbortController();
    const batches = [];

    setTimeout(() => controller.abort(), 5);

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      batches.push(batch);
    }

    assertTrue(batches.length >= 1);
  });
});
