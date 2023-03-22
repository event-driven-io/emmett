import { EventStore } from 'src/eventStore';
import { ConnectionWrapper } from '../shared/lifetime';

export type InMemoryEventStoreOptions = {
  type: 'inmemory';
};

type InMemoryConnection = ConnectionWrapper<undefined>;

const getInMemoryEventStoreConnection = (): InMemoryConnection =>
  ConnectionWrapper<undefined>(undefined, () => Promise.resolve());

const ping = async (connection: InMemoryConnection): Promise<'pong'> => {
  connection.assertIsOpen();
  return Promise.resolve('pong');
};

export const getInMemoryEventStore = (
  _options: InMemoryEventStoreOptions
): EventStore => {
  const connection = getInMemoryEventStoreConnection();

  return {
    type: 'inmemory',
    close: connection.close,
    init: async () => {
      connection.assertIsOpen();
      return Promise.resolve();
    },
    diagnostics: {
      ping: () => ping(connection),
    },
  };
};
