import { describe, it } from 'vitest';
import { ProcessorCheckpoint } from '../processors';
import { isNotInternalEvent } from '../eventStore/events';
import { assertDeepEqual, assertEqual } from '../testing';
import type { Event, RecordedMessage } from '../typing';
import { inMemoryMessageSource } from './inMemoryMessageSource';

const messageAt = (checkpoint: string): RecordedMessage =>
  ({
    type: 'Tested',
    data: {},
    metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage;

void describe('inMemoryMessageSource', () => {
  void it('reads everything appended so far from the beginning', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2')],
    });

    const controller = new AbortController();
    const read = [];

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      read.push(
        ...batch.messages.filter((m) => isNotInternalEvent(m as Event)),
      );
      controller.abort();
    }

    assertEqual(read.length, 2);
  });

  void it('reports the last appended checkpoint as the tail', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('7')],
    });

    assertEqual(await source.readLastCheckpoint(), ProcessorCheckpoint('7'));
  });

  void it('reports no tail while empty', async () => {
    const source = inMemoryMessageSource();

    assertEqual(await source.readLastCheckpoint(), null);
  });

  void it('skips everything at or before the requested checkpoint', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2'), messageAt('3')],
    });

    const controller = new AbortController();
    const read: RecordedMessage[] = [];

    for await (const batch of source.read({
      from: { lastCheckpoint: ProcessorCheckpoint('1') },
      signal: controller.signal,
    })) {
      read.push(
        ...(batch.messages.filter((m) =>
          isNotInternalEvent(m as Event),
        ) as RecordedMessage[]),
      );
      controller.abort();
    }

    assertDeepEqual(
      read.map((m) => m.metadata.checkpoint),
      [ProcessorCheckpoint('2'), ProcessorCheckpoint('3')],
    );
  });

  void it('picks up messages appended while reading', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1')],
    });

    const controller = new AbortController();
    const read: RecordedMessage[] = [];
    let appended = false;

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      read.push(
        ...(batch.messages.filter((m) =>
          isNotInternalEvent(m as Event),
        ) as RecordedMessage[]),
      );
      if (read.length === 1 && !appended) {
        appended = true;
        source.append(messageAt('2'));
      }
      if (read.length >= 2) controller.abort();
    }

    assertEqual(read.length, 2);
  });
});
