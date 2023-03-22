import { EventStore } from 'src/eventStore';

export type InMemoryEventStoreOptions = {
  type: 'inMemory';
};

export const getInMemoryEventStore = (
  _options: InMemoryEventStoreOptions
): EventStore => {
  return {
    init: () => {
      return Promise.resolve();
    },
  };
};
