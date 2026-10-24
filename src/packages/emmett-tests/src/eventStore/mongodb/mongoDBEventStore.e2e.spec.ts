import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import { randomUUID } from 'crypto';
import { afterAll, describe, inject } from 'vitest';
import {
  testAppendToStream,
  testCommandHandling,
  type EventStoreFactory,
} from '../features';

declare module 'vitest' {
  export interface ProvidedContext {
    sharedMongoDBConnectionString: string;
  }
}

describe.each(['COLLECTION_PER_STREAM_TYPE', 'SINGLE_COLLECTION'] as const)(
  'MongoDBEventStore using %s',
  (storage) => {
    const eventStores: ReturnType<typeof getMongoDBEventStore>[] = [];

    const eventStoreFactory: EventStoreFactory = () => {
      const connectionString = new URL(inject('sharedMongoDBConnectionString'));
      connectionString.pathname = `/emmett_test_${randomUUID().replaceAll('-', '')}`;

      const eventStore = getMongoDBEventStore({
        connectionString: connectionString.toString(),
        clientOptions: { directConnection: true },
        storage,
      });
      eventStores.push(eventStore);
      return Promise.resolve(eventStore);
    };

    afterAll(async () => {
      for (const eventStore of eventStores) await eventStore.close();
    });

    testAppendToStream(eventStoreFactory);

    testCommandHandling(eventStoreFactory);
  },
);
