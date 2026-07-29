import {
  assertEqual,
  assertRejects,
  type MessageProcessor,
} from '@event-driven-io/emmett';
import { EventStoreDBClient } from '@eventstore/db-client';
import { describe, it, vi } from 'vitest';
import { eventStoreDBEventStoreConsumer } from './eventStoreDBEventStoreConsumer';

const fakeClient = (): {
  client: EventStoreDBClient;
  disposals: () => number;
} => {
  let disposals = 0;

  return {
    disposals: () => disposals,
    client: {
      dispose: () => {
        disposals++;
        return Promise.resolve();
      },
    } as unknown as EventStoreDBClient,
  };
};

void describe('eventStoreDBEventStoreConsumer client ownership', () => {
  void it('disposes the client it created on close', async () => {
    const { client, disposals } = fakeClient();
    const connectionString = vi
      .spyOn(EventStoreDBClient, 'connectionString')
      .mockReturnValue(client);

    try {
      const consumer = eventStoreDBEventStoreConsumer({
        connectionString: 'esdb://localhost:2113?tls=false',
      });

      await consumer.close();

      assertEqual(1, disposals());
    } finally {
      connectionString.mockRestore();
    }
  });

  void it('leaves a client it was given to its owner', async () => {
    const { client, disposals } = fakeClient();

    const consumer = eventStoreDBEventStoreConsumer({ client });

    await consumer.close();

    assertEqual(0, disposals());
  });

  void it('closes a processor that fails to initialise exactly once', async () => {
    const { client } = fakeClient();
    let closes = 0;
    const failure = new Error('Init failed');
    const processor = {
      id: 'failing',
      instanceId: 'failing',
      type: 'reactor',
      isActive: false,
      init: () => Promise.reject(failure),
      start: () => Promise.resolve('BEGINNING'),
      close: () => {
        closes++;
        return Promise.resolve();
      },
      handle: () => Promise.resolve(),
      whenProcessed: () => Promise.resolve(),
    } as MessageProcessor;
    const consumer = eventStoreDBEventStoreConsumer({
      client,
      processors: [processor],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await assertRejects(consumer.start(), failure);
      await consumer.close();
    } finally {
      log.mockRestore();
    }

    assertEqual(1, closes);
  });
});
