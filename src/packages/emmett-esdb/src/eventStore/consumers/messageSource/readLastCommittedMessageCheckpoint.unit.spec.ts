import {
  assertEqual,
  asyncIterable,
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

  const projectionStreams = [
    ['$by_category', '$ce-order'],
    ['$by_event_type', '$et-OrderPlaced'],
    ['$by_correlation_id', '$bc-correlation-id'],
    ['$stream_by_category', '$category-order'],
    ['$streams', '$streams'],
  ] as const;

  void it.each(projectionStreams)(
    'reads the last link revision from the %s projection stream',
    async (_projection, streamName) => {
      const expectedCheckpoint = bigIntProcessorCheckpoint(7n);
      let releasedReads = 0;
      const client = {
        readStream: asyncIterable(
          [
            {
              event: {
                id: 'original-event-id',
                type: 'OrderPlaced',
                streamId: 'order-123',
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
      assertEqual(1, releasedReads);
    },
  );

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
