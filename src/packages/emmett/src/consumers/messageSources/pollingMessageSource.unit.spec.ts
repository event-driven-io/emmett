import type { MaybePromise } from '@event-driven-io/pongo';
import { describe, it } from 'vitest';
import { MessageSourceCaughtUp } from '../../eventStore/events';
import { ProcessorCheckpoint } from '../../processors';
import { assertDeepEqual, assertEqual, assertTrue } from '../../testing';
import type { AnyMessage, RecordedMessage } from '../../typing';
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
    readBatch: (
      options: PollingReadBatchOptions,
    ): MaybePromise<PollingReadBatchResult<AnyMessage, never>> => {
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
  const received = [];

  for await (const message of source.read({
    from,
    signal: controller.signal,
  })) {
    received.push(message);
    if (received.length >= take) controller.abort();
  }

  return received;
};

void describe('nextPollingWaitTime', () => {
  void it('falls back to the polling frequency while messages keep coming', () => {
    assertEqual(nextPollingWaitTime(800, true, 50), 50);
  });

  void it('doubles the wait while the store has nothing left', () => {
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
      readLastMessageCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    await readAll(source, 'BEGINNING', 1);

    assertEqual(reads.calls[0]!.after, null);
  });

  void it('resolves END through the last checkpoint', async () => {
    const reads = scriptedReads([{ checkpoints: ['6'] }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastMessageCheckpoint: () =>
        Promise.resolve(ProcessorCheckpoint('5')),
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
      readLastMessageCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    const received = await readAll(
      source,
      { lastCheckpoint: ProcessorCheckpoint('0') },
      3,
    );

    assertEqual(reads.calls[0]!.after, ProcessorCheckpoint('0'));
    assertEqual(reads.calls[1]!.after, ProcessorCheckpoint('2'));
    assertDeepEqual(
      received.map((m) => m.metadata.checkpoint),
      [
        ProcessorCheckpoint('1'),
        ProcessorCheckpoint('2'),
        ProcessorCheckpoint('3'),
      ],
    );
  });

  void it('emits a caught up control message once nothing is left', async () => {
    const reads = scriptedReads([
      { checkpoints: ['1'], areMessagesLeft: false },
    ]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastMessageCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: 0,
    });

    const received = await readAll(source, 'BEGINNING', 2);

    assertEqual(received.length, 2);
    assertTrue(MessageSourceCaughtUp.is(received[1]!));
    assertEqual(received[1]!.metadata.checkpoint, ProcessorCheckpoint('1'));
  });

  void it('passes the requested batch size down to the read', async () => {
    const reads = scriptedReads([{ checkpoints: ['1'] }]);

    const source = pollingMessageSource({
      readBatch: reads.readBatch,
      readLastMessageCheckpoint: () => Promise.resolve(null),
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
      readLastMessageCheckpoint: () => Promise.resolve(null),
      pullingFrequencyInMs: DefaultPollingInitialBackoffInMs,
    });

    const controller = new AbortController();
    const received = [];

    setTimeout(() => controller.abort(), 5);

    for await (const message of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      received.push(message);
    }

    assertTrue(received.length >= 1);
  });
});
