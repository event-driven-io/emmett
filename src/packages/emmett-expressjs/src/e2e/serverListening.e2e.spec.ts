import {
  assertDeepEqual,
  getInMemoryEventStore,
  logger,
  type LogEvent,
} from '@event-driven-io/emmett';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'vitest';
import { getApplication, startAPI } from '..';
import { shoppingCartApi } from './commandHandler/api';

void describe('Server listening E2E', () => {
  void it('logs Server listening to the logger passed to startAPI', async () => {
    const records: LogEvent[] = [];

    const application = getApplication({
      apis: [shoppingCartApi(getInMemoryEventStore())],
    });

    const server = startAPI(application, {
      port: 0,
      observability: {
        logger: logger({ log: (event) => records.push(event) }),
      },
    });

    try {
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;

      assertDeepEqual(
        records.map(({ name, data, metadata: { level } }) => ({
          name,
          data,
          level,
        })),
        [
          {
            name: 'Server listening',
            data: {
              body: 'Server listening',
              attributes: { 'server.port': port },
            },
            level: 'info',
          },
        ],
      );
    } finally {
      server.close();
    }
  });
});
