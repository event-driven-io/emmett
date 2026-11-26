import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
  MessageSourceCaughtUp,
  MessageSourceControlMessage,
} from '../eventStore/events';
import { bigIntProcessorCheckpoint, ProcessorCheckpoint } from '../processors';
import { assertDeepEqual, assertEqual } from '../testing';
import { asyncIterable } from '../utils';
import type { RecordedMessage } from '../typing';
import { inMemoryMessageSource } from './inMemoryMessageSource';
import {
  boundedMessageQueue,
  type MessageSourceMessage,
} from './messageSources';

const messageAt = (checkpoint: string): RecordedMessage =>
  ({
    type: 'Tested',
    data: {},
    metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

const readMessages = async (
  source: ReturnType<typeof inMemoryMessageSource>,
  from: Parameters<typeof source.read>[0]['from'],
  take: number,
): Promise<RecordedMessage[]> => {
  const controller = new AbortController();
  const read: RecordedMessage[] = [];

  for await (const message of source.read({
    from,
    signal: controller.signal,
  })) {
    if (MessageSourceControlMessage.is(message)) continue;

    read.push(message);

    if (read.length >= take) controller.abort();
  }

  return read;
};

const startReading = (
  source: ReturnType<typeof inMemoryMessageSource>,
  from: Parameters<typeof source.read>[0]['from'],
) => {
  const controller = new AbortController();
  const iterator = source
    .read({ from, signal: controller.signal })
    [Symbol.asyncIterator]();

  let waiting: Promise<IteratorResult<MessageSourceMessage>> | undefined;

  const next = () => {
    const result = waiting ?? iterator.next();
    waiting = undefined;
    return result;
  };

  const take = async (count: number): Promise<MessageSourceMessage[]> => {
    const read: MessageSourceMessage[] = [];

    while (read.length < count) {
      const result = await next();
      if (result.done) break;
      read.push(result.value);
    }

    return read;
  };

  const waitForMessages = async () => {
    waiting = iterator.next();
    await settle();
  };

  return {
    take,
    next,
    waitForMessages,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
};

const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

void describe('inMemoryMessageSource', () => {
  void it('reads everything appended so far from the beginning', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2')],
    });

    const read = await readMessages(source, 'BEGINNING', 2);

    assertEqual(read.length, 2);
  });

  void it('reports the last appended checkpoint', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('7')],
    });

    assertEqual(
      await source.readLastMessageCheckpoint(),
      ProcessorCheckpoint('7'),
    );
  });

  void it('reports no checkpoint while empty', async () => {
    const source = inMemoryMessageSource();

    assertEqual(await source.readLastMessageCheckpoint(), null);
  });

  void it('skips everything at or before the requested checkpoint', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2'), messageAt('3')],
    });

    const read = await readMessages(
      source,
      { lastCheckpoint: ProcessorCheckpoint('1') },
      2,
    );

    assertDeepEqual(
      read.map((m) => m.metadata.checkpoint),
      [ProcessorCheckpoint('2'), ProcessorCheckpoint('3')],
    );
  });

  void it('reads everything appended so far from the beginning, then reports caught up', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2')],
    });
    const reader = startReading(source, 'BEGINNING');

    assertDeepEqual(await reader.take(3), [
      messageAt('1'),
      messageAt('2'),
      MessageSourceCaughtUp(ProcessorCheckpoint('2')),
    ]);

    reader.abort();
  });

  void it('reports only caught up for an empty source read from the beginning', async () => {
    const source = inMemoryMessageSource();
    const reader = startReading(source, 'BEGINNING');

    assertDeepEqual(await reader.take(1), [
      MessageSourceCaughtUp(ProcessorCheckpoint('0')),
    ]);

    reader.abort();
  });

  void it('reads from the end only the caught up at the last message', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2')],
    });
    const reader = startReading(source, 'END');

    assertDeepEqual(await reader.take(1), [
      MessageSourceCaughtUp(ProcessorCheckpoint('2')),
    ]);

    reader.abort();
  });

  void it('gives two readers every message independently', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1')],
    });
    const first = startReading(source, 'BEGINNING');
    const second = startReading(source, 'BEGINNING');

    const appended = [
      messageAt('1'),
      MessageSourceCaughtUp(ProcessorCheckpoint('1')),
    ];
    assertDeepEqual(await first.take(2), appended);
    assertDeepEqual(await second.take(2), appended);

    first.abort();
    second.abort();
  });

  void it('ends the read when a waiting reader is aborted', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1')],
    });
    const reader = startReading(source, 'BEGINNING');

    await reader.take(2);

    await reader.waitForMessages();
    reader.abort();

    assertDeepEqual(await reader.next(), { done: true, value: undefined });
  });

  void it('rejects the pulling frequency option', () => {
    inMemoryMessageSource({
      // @ts-expect-error the source is pushed to, it does not poll
      pullingFrequencyInMs: 10,
    });
  });

  void describe('without timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    void it('schedules no timer while a caught-up reader waits', async () => {
      const source = inMemoryMessageSource({
        messages: [messageAt('1')],
      });
      const reader = startReading(source, 'BEGINNING');

      await reader.take(2);

      await reader.waitForMessages();

      assertEqual(vi.getTimerCount(), 0);

      reader.abort();
      await reader.next();
    });
  });

  void describe('from batches', () => {
    void it('ends each batch with its own caught up', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable([
          [messageAt('1'), messageAt('2')],
          [messageAt('3')],
        ])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('3'),
      });
      const reader = startReading(source, 'BEGINNING');

      assertDeepEqual(await reader.take(5), [
        messageAt('1'),
        messageAt('2'),
        MessageSourceCaughtUp(ProcessorCheckpoint('2')),
        messageAt('3'),
        MessageSourceCaughtUp(ProcessorCheckpoint('3')),
      ]);

      reader.abort();
    });

    void it('skips messages at or before the requested checkpoint', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable([
          [messageAt('1'), messageAt('2')],
          [messageAt('3')],
        ])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('3'),
      });
      const reader = startReading(source, {
        lastCheckpoint: ProcessorCheckpoint('1'),
      });

      assertDeepEqual(await reader.take(4), [
        messageAt('2'),
        MessageSourceCaughtUp(ProcessorCheckpoint('2')),
        messageAt('3'),
        MessageSourceCaughtUp(ProcessorCheckpoint('3')),
      ]);

      reader.abort();
    });

    void it('reads from the end only messages after the last checkpoint', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable([
          [messageAt('1'), messageAt('2')],
          [messageAt('3')],
        ])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('2'),
      });
      const reader = startReading(source, 'END');

      assertDeepEqual(await reader.take(3), [
        MessageSourceCaughtUp(ProcessorCheckpoint('2')),
        messageAt('3'),
        MessageSourceCaughtUp(ProcessorCheckpoint('3')),
      ]);

      reader.abort();
    });

    void it('reports the last checkpoint it is given', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable<RecordedMessage[]>([])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('7'),
      });

      assertEqual(
        await source.readLastMessageCheckpoint(),
        ProcessorCheckpoint('7'),
      );
    });

    void it('ends the read when the batches end', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable([[messageAt('1')]])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('1'),
      });
      const reader = startReading(source, 'BEGINNING');

      await reader.take(2);

      assertDeepEqual(await reader.next(), { done: true, value: undefined });
    });

    void it('continues the same batches in the next read after a read stopped', async () => {
      const source = inMemoryMessageSource({
        messages: asyncIterable([[messageAt('1')], [messageAt('2')]])(),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('2'),
      });
      const first = startReading(source, 'BEGINNING');

      await first.take(2);
      first.abort();
      await first.next();

      const second = startReading(source, {
        lastCheckpoint: ProcessorCheckpoint('1'),
      });

      assertDeepEqual(await second.take(2), [
        messageAt('2'),
        MessageSourceCaughtUp(ProcessorCheckpoint('2')),
      ]);

      second.abort();
    });

    void it('gives the next read a batch that arrived after a waiting read stopped', async () => {
      const appended = boundedMessageQueue<RecordedMessage[]>();
      const source = inMemoryMessageSource({
        messages: appended.iterate(new AbortController().signal),
        readLastMessageCheckpoint: () => ProcessorCheckpoint('2'),
      });
      const first = startReading(source, 'BEGINNING');

      await appended.push([messageAt('1')]);
      await first.take(2);
      await first.waitForMessages();
      first.abort();
      await first.next();

      await appended.push([messageAt('2')]);
      const second = startReading(source, {
        lastCheckpoint: ProcessorCheckpoint('1'),
      });

      assertDeepEqual(await second.take(2), [
        messageAt('2'),
        MessageSourceCaughtUp(ProcessorCheckpoint('2')),
      ]);

      second.abort();
    });

    void it('keeps the same abort listeners on a reader across many batches', async () => {
      const appended = boundedMessageQueue<RecordedMessage[]>();
      const source = inMemoryMessageSource({
        messages: appended.iterate(new AbortController().signal),
        readLastMessageCheckpoint: () => null,
      });
      const reader = startReading(source, 'BEGINNING');

      await reader.waitForMessages();
      const listenersWhileWaiting = getEventListeners(
        reader.signal,
        'abort',
      ).length;

      for (let batch = 1n; batch <= 20n; batch++) {
        const checkpoint = bigIntProcessorCheckpoint(batch);
        await appended.push([messageAt(checkpoint)]);
        assertDeepEqual(await reader.take(2), [
          messageAt(checkpoint),
          MessageSourceCaughtUp(checkpoint),
        ]);
        await reader.waitForMessages();
      }

      assertEqual(
        getEventListeners(reader.signal, 'abort').length,
        listenersWhileWaiting,
      );

      reader.abort();
    });

    void it('closes with the given close', async () => {
      let closed = false;
      const source = inMemoryMessageSource({
        messages: asyncIterable<RecordedMessage[]>([])(),
        readLastMessageCheckpoint: () => null,
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      });

      await source.close();

      assertEqual(closed, true);
    });

    void describe('without timers', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      void it('delivers a batch to a waiting reader without any timer', async () => {
        const appended = boundedMessageQueue<RecordedMessage[]>();
        const source = inMemoryMessageSource({
          messages: appended.iterate(new AbortController().signal),
          readLastMessageCheckpoint: () => null,
        });
        const reader = startReading(source, 'BEGINNING');

        await reader.waitForMessages();
        await appended.push([messageAt('1')]);

        assertDeepEqual(await reader.take(2), [
          messageAt('1'),
          MessageSourceCaughtUp(ProcessorCheckpoint('1')),
        ]);
        assertEqual(vi.getTimerCount(), 0);

        reader.abort();
      });
    });
  });
});
