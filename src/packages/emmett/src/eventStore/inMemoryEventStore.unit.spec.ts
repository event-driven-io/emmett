import { describe } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import { testAggregateStream } from '../testing/features';

// Events & Entity

void describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();
  void testAggregateStream(() => Promise.resolve(eventStore));
});
