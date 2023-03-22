import { EventStore } from 'src/eventStore';

export type InMemoryEventStoreOptions = {
  type: 'inmemory';
};

export const getInMemoryEventStore = (
  _options: InMemoryEventStoreOptions
): EventStore => {
  return {
    type: 'inmemory',
    init: () => {
      return Promise.resolve();
    },
    diagnostics: {
      ping: () => Promise.resolve('pong'),
    },
  };
};
