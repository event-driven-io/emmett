import { jsonEvent } from '@eventstore/db-client';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from './eventStoreDBContainer';
import { assertOk } from '@event-driven-io/emmett';

void describe('EventStoreDBContainer', () => {
  let container: StartedEventStoreDBContainer;

  beforeEach(async () => {
    container = await new EventStoreDBContainer().start();
  });

  void it('should connect to EventStoreDB and append new event', async () => {
    const client = container.getClient();

    const result = await client.appendToStream(
      `test-${randomUUID()}`,
      jsonEvent({ type: 'test-event', data: { test: 'test' } }),
    );

    assertOk(result.success);
  });

  after(async () => {
    await container.stop();
  });
});
