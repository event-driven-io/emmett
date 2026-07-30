import { describe, it } from 'vitest';
import { MessageSourceControlMessage } from '../eventStore/events';
import { ProcessorCheckpoint } from '../processors';
import { assertDeepEqual, assertEqual } from '../testing';
import type { RecordedMessage } from '../typing';
import { inMemoryMessageSource } from './inMemoryMessageSource';

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
  onMessage?: (read: RecordedMessage[]) => void,
): Promise<RecordedMessage[]> => {
  const controller = new AbortController();
  const read: RecordedMessage[] = [];

  for await (const message of source.read({
    from,
    signal: controller.signal,
  })) {
    if (MessageSourceControlMessage.is(message)) continue;

    read.push(message);
    onMessage?.(read);

    if (read.length >= take) controller.abort();
  }

  return read;
};

void describe('inMemoryMessageSource', () => {
  void it('reads everything appended so far from the beginning', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1'), messageAt('2')],
    });

    const read = await readMessages(source, 'BEGINNING', 2);

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

  void it('picks up messages appended while reading', async () => {
    const source = inMemoryMessageSource({
      messages: [messageAt('1')],
    });

    let appended = false;

    const read = await readMessages(source, 'BEGINNING', 2, (soFar) => {
      if (soFar.length === 1 && !appended) {
        appended = true;
        source.append(messageAt('2'));
      }
    });

    assertEqual(read.length, 2);
  });
});
