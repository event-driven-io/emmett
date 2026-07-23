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
    const client = {
      readAll: asyncIterable([
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
      ]),
      readStream: asyncIterable([
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
      ]),
    } as unknown as EventStoreDBClient;

    const checkpoint = await readLastCommittedMessageCheckpoint(client, {
      stream: streamName,
      options: { resolveLinkTos: true },
    });

    assertEqual(checkpoint, expectedCheckpoint);
  });
});

const asyncIterable = <T>(items: T[]) =>
  async function* (): AsyncIterable<T> {
    yield* items;
  };
