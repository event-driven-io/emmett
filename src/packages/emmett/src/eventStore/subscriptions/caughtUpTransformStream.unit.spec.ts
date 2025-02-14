import assert from 'node:assert';
import { describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { collect } from '../../streaming';
import { noMoreWritingOn, writeToStream } from '../../streaming/writers';
import { assertDeepEqual } from '../../testing';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import { globalStreamCaughtUp } from '../events';
import {
  CaughtUpTransformStream,
  streamTrackingGlobalPosition,
} from './caughtUpTransformStream';

type ShoppingCartOpened = Event<'ShoppingCartOpened', { cartId: string }>;

void describe('CaughtUpTransformStream', () => {
  const readEvent = (
    globalPosition: bigint,
  ): ReadEvent<ShoppingCartOpened, ReadEventMetadataWithGlobalPosition> => ({
    type: 'ShoppingCartOpened',
    kind: 'Event',
    data: { cartId: 'cartId' },
    metadata: {
      messageId: uuid(),
      globalPosition,
      streamPosition: globalPosition,
      streamName: 'test',
    },
  });

  void it('should process initial events and emit caught up event', async () => {
    const initialEvents = [readEvent(1n), readEvent(2n), readEvent(3n)];

    const stream = await noMoreWritingOn(
      streamTrackingGlobalPosition(initialEvents),
    );

    const results = await collect(stream);

    assertDeepEqual(results, [
      ...initialEvents,
      globalStreamCaughtUp({ globalPosition: 3n }),
    ]);
  });

  void it('should process new events and emit caught up event when highest position is reached', async () => {
    const initialEvents = [readEvent(1n), readEvent(2n)];
    const newEvent = readEvent(3n);

    const stream = streamTrackingGlobalPosition(initialEvents);

    const [_, results] = await Promise.all([
      writeToStream(stream, [newEvent]),
      collect(stream.readable),
    ]);

    assert.deepEqual(results, [
      ...initialEvents,
      globalStreamCaughtUp({ globalPosition: 2n }),
      newEvent,
      globalStreamCaughtUp({ globalPosition: 3n }),
    ]);
  });

  void it('should handle no initial events and emit caught up event', async () => {
    const stream = new CaughtUpTransformStream([]);
    await stream.writable.close();

    const results = await collect(stream.readable);

    assertDeepEqual(results, [globalStreamCaughtUp({ globalPosition: 0n })]);
  });

  void it('should not emit caught up event if current position is lower than highest position', async () => {
    const initialEvents = [readEvent(5n)];
    const stream = streamTrackingGlobalPosition(initialEvents);
    stream.logPosition = 10n;
    const newEvent = readEvent(6n);

    const [_, results] = await Promise.all([
      writeToStream(stream, [newEvent]),
      collect(stream.readable),
    ]);

    assertDeepEqual(results, [
      ...initialEvents,
      globalStreamCaughtUp({ globalPosition: 5n }),
      newEvent,
    ]);
  });

  void it('should handle an event with the same global position as the highest position', async () => {
    const initialEvents = [readEvent(5n)];
    const stream = streamTrackingGlobalPosition(initialEvents);
    stream.logPosition = 10n;
    const newEvent = readEvent(10n);

    const [_, results] = await Promise.all([
      writeToStream(stream, [newEvent]),
      collect(stream.readable),
    ]);

    assertDeepEqual(results, [
      ...initialEvents,
      globalStreamCaughtUp({ globalPosition: 5n }),
      newEvent,
      globalStreamCaughtUp({ globalPosition: 10n }),
    ]);
  });
});
