import { assertOk } from '@event-driven-io/emmett';
import { jsonEvent } from '@eventstore/db-client';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  EventStoreDBContainer,
  getEventStoreDBTestContainer,
  releaseShartedEventStoreDBTestContainer,
} from './eventStoreDBContainer';

void describe('EventStoreDBContainer', () => {
  void it('should connect to EventStoreDB and append new event', async () => {
    const container = await new EventStoreDBContainer().start();

    try {
      const client = container.getClient();

      const result = await client.appendToStream(
        `test-${randomUUID()}`,
        jsonEvent({ type: 'test-event', data: { test: 'test' } }),
      );

      assertOk(result.success);
    } finally {
      await container.stop();
    }
  });

  void it('should connect to shared EventStoreDB and append new event', async () => {
    const container = await getEventStoreDBTestContainer();

    try {
      const client = container.getClient();

      const result = await client.appendToStream(
        `test-${randomUUID()}`,
        jsonEvent({ type: 'test-event', data: { test: 'test' } }),
      );

      assertOk(result.success);
    } finally {
      await releaseShartedEventStoreDBTestContainer();
    }
  });

  void it('should connect to multiple shared EventStoreDB and append new event', async () => {
    const containers = [
      await getEventStoreDBTestContainer(),
      await getEventStoreDBTestContainer(),
      await getEventStoreDBTestContainer(),
    ];

    try {
      const container = containers[0]!;
      const client = container.getClient();

      const result = await client.appendToStream(
        `test-${randomUUID()}`,
        jsonEvent({ type: 'test-event', data: { test: 'test' } }),
      );

      assertOk(result.success);
    } finally {
      for (let i = 0; i < containers.length; i++) {
        await releaseShartedEventStoreDBTestContainer();
      }
    }
  });
});
