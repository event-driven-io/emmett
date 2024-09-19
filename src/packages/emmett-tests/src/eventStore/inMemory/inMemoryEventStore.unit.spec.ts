import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { describe } from 'node:test';
import { testAggregateStream } from '../features';

// Events & Entity

void describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();
  void testAggregateStream(() => Promise.resolve(eventStore));
});
