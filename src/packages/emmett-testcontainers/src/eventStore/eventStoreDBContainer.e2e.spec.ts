import { assertDeepEqual, assertOk } from '@event-driven-io/emmett';
import { jsonEvent } from '@eventstore/db-client';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  EVENTSTOREDB_PORT,
  EventStoreDBContainer,
  getSharedEventStoreDBTestContainer,
  releaseSharedEventStoreDBTestContainer,
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
    const container = await getSharedEventStoreDBTestContainer();

    try {
      const client = container.getClient();

      const result = await client.appendToStream(
        `test-${randomUUID()}`,
        jsonEvent({ type: 'test-event', data: { test: 'test' } }),
      );

      assertOk(result.success);
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
  });

  void it('keeps the shared EventStoreDB running until every holder releases it', async () => {
    const container = await getSharedEventStoreDBTestContainer();
    await getSharedEventStoreDBTestContainer();

    try {
      await releaseSharedEventStoreDBTestContainer();

      const result = await container
        .getClient()
        .appendToStream(
          `test-${randomUUID()}`,
          jsonEvent({ type: 'test-event', data: { test: 'test' } }),
        );

      assertOk(result.success);
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
  });

  void it('waits as long as the client deadline before timing out writes', async () => {
    const container = await getSharedEventStoreDBTestContainer();

    try {
      const response = await fetch(
        `http://${container.getHost()}:${container.getMappedPort(EVENTSTOREDB_PORT)}/info/options`,
      );
      const options = (await response.json()) as {
        name: string;
        value: string;
      }[];

      const timeouts = options
        .filter(({ name }) =>
          ['PrepareTimeoutMs', 'CommitTimeoutMs', 'WriteTimeoutMs'].includes(
            name,
          ),
        )
        .map(({ name, value }) => ({ name, value }));

      assertDeepEqual(timeouts, [
        { name: 'PrepareTimeoutMs', value: '10000' },
        { name: 'CommitTimeoutMs', value: '10000' },
        { name: 'WriteTimeoutMs', value: '10000' },
      ]);
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
  });

  void it('should connect to multiple shared EventStoreDB and append new event', async () => {
    const containers = [
      await getSharedEventStoreDBTestContainer(),
      await getSharedEventStoreDBTestContainer(),
      await getSharedEventStoreDBTestContainer(),
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
        await releaseSharedEventStoreDBTestContainer();
      }
    }
  });
});
