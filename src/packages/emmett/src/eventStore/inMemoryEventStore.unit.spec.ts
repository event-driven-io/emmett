/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import { testAggregateStream } from '../testing';

// Events & Entity

describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();
  testAggregateStream(eventStore);
});
