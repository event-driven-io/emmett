import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { describe } from 'vitest';
import {
  testReactorRecordsFailureAsEvent,
  testReactorSkipsAndStops,
  type ConsumerFactory,
  type ReactorConsumer,
} from './reactorErrors.features';

const inMemoryConsumerFactory: ConsumerFactory = () => {
  const eventStore = getInMemoryEventStore();

  const consumer: ReactorConsumer = eventStore.consumer();

  return Promise.resolve({ eventStore, consumer });
};

void describe('In-memory consumer', () => {
  testReactorRecordsFailureAsEvent(inMemoryConsumerFactory);
  testReactorSkipsAndStops(inMemoryConsumerFactory);
});
