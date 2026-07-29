import {
  assertEqual,
  bigIntProcessorCheckpoint,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import { describe, it } from 'vitest';
import { readLastCommittedMessageCheckpoint } from './readLastCommittedMessageCheckpoint';

void describe('readLastCommittedMessageCheckpoint', () => {
  void it('reads regular $-prefixed named streams directly', async () => {
    const streamName = '$custom-system-stream';
    const expectedCheckpoint = bigIntProcessorCheckpoint(3n);
    const client = {
      readStream: asyncIterable([
        {
          event: {
            id: 'event-id',
            type: 'SomeEvent',
            streamId: streamName,
            revision: 3n,
            data: {},
            metadata: {},
          },
        },
      ]),
    } as unknown as EventStoreDBClient;

    const checkpoint = await readLastCommittedMessageCheckpoint(client, {
      stream: streamName,
    });

    assertEqual(checkpoint, expectedCheckpoint);
  });

  void it('waits for $et projection streams and returns the projection checkpoint', async () => {
    const streamName = '$et-SomeEvent';
    const expectedCheckpoint = bigIntProcessorCheckpoint(7n);
    let releasedReads = 0;
    const client = {
      readAll: asyncIterable(
        [
          {
            event: {
              id: 'original-event-id',
              type: 'SomeEvent',
              streamId: 'regular-stream',
              revision: 3n,
              position: { commit: 99n, prepare: 99n },
              data: {},
              metadata: {},
            },
          },
        ],
        () => releasedReads++,
      ),
      readStream: asyncIterable(
        [
          {
            event: {
              id: 'original-event-id',
              type: 'SomeEvent',
              streamId: 'regular-stream',
              revision: 3n,
              position: { commit: 99n, prepare: 99n },
              data: {},
              metadata: {},
            },
            link: {
              id: 'link-event-id',
              type: '$>',
              streamId: streamName,
              revision: 7n,
              position: { commit: 101n, prepare: 101n },
              data: {},
              metadata: {},
            },
          },
        ],
        () => releasedReads++,
      ),
    } as unknown as EventStoreDBClient;

    const checkpoint = await readLastCommittedMessageCheckpoint(client, {
      stream: streamName,
      options: { resolveLinkTos: true },
    });

    assertEqual(checkpoint, expectedCheckpoint);
    assertEqual(2, releasedReads);
  });

  void it('waits for $ce category streams and returns the category checkpoint', async () => {
    const streamName = '$ce-order';
    const expectedCheckpoint = bigIntProcessorCheckpoint(5n);
    let releasedReads = 0;
    const client = {
      readAll: asyncIterable(
        [
          {
            event: {
              id: 'original-event-id',
              type: 'OrderPlaced',
              streamId: 'order-123',
              revision: 2n,
              position: { commit: 80n, prepare: 80n },
              data: {},
              metadata: {},
            },
          },
        ],
        () => releasedReads++,
      ),
      readStream: asyncIterable(
        [
          {
            event: {
              id: 'original-event-id',
              type: 'OrderPlaced',
              streamId: 'order-123',
              revision: 2n,
              position: { commit: 80n, prepare: 80n },
              data: {},
              metadata: {},
            },
            link: {
              id: 'link-event-id',
              type: '$>',
              streamId: streamName,
              revision: 5n,
              position: { commit: 82n, prepare: 82n },
              data: {},
              metadata: {},
            },
          },
        ],
        () => releasedReads++,
      ),
    } as unknown as EventStoreDBClient;

    const checkpoint = await readLastCommittedMessageCheckpoint(client, {
      stream: streamName,
      options: { resolveLinkTos: true },
    });

    assertEqual(expectedCheckpoint, checkpoint);
    assertEqual(2, releasedReads);
  });

  void it('finds the latest event behind a full page of system events', async () => {
    const systemEvents = Array.from({ length: 32 }, (_, index) => ({
      event: {
        id: `system-${index}`,
        type: '$SystemEvent',
        streamId: '$system',
        revision: BigInt(index),
        position: {
          commit: BigInt(132 - index),
          prepare: BigInt(132 - index),
        },
        data: {},
        metadata: {},
      },
    }));
    const expectedCheckpoint = bigIntProcessorCheckpoint(99n);
    const pages = [
      systemEvents,
      [
        systemEvents[31]!,
        {
          event: {
            id: 'domain-event',
            type: 'SomeEvent',
            streamId: 'regular-stream',
            revision: 0n,
            position: { commit: 99n, prepare: 99n },
            data: {},
            metadata: {},
          },
        },
      ],
    ];
    let readPages = 0;
    const client = {
      readAll: () => asyncIterable(pages[readPages++]!)(),
    } as unknown as EventStoreDBClient;

    const checkpoint = await readLastCommittedMessageCheckpoint(client, {
      stream: '$all',
    });

    assertEqual(expectedCheckpoint, checkpoint);
    assertEqual(2, readPages);
  });
});

const asyncIterable =
  <T>(items: T[], onDone?: () => void) =>
  () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const iterable = (async function* (): AsyncIterableIterator<T> {
      try {
        yield* items;
      } finally {
        onDone?.();
      }
    })();

    return iterable;
  };
