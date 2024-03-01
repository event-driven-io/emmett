/* eslint-disable @typescript-eslint/no-floating-promises */
import { jsonEvent } from '@eventstore/db-client';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from './eventStoreDBContainer';

describe('EventStoreDBContainer', () => {
  let container: StartedEventStoreDBContainer;

  beforeEach(async () => {
    container = await new EventStoreDBContainer().start();
  });

  it('should connect to EventStoreDB and append new event', async () => {
    const client = container.getClient();

    const result = await client.appendToStream(
      `test-${uuid()}`,
      jsonEvent({ type: 'test-event', data: { test: 'test' } }),
    );

    assert.ok(result.success);
  });

  after(async () => {
    await container.stop();
  });
});
