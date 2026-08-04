import { EventStoreDBClient } from '@eventstore/db-client';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    sharedEventStoreDBConnectionString: string;
  }
}

export type SharedEventStoreDB = {
  connectionString: string;
  getClient: () => EventStoreDBClient;
};

export const getSharedEventStoreDB = (): SharedEventStoreDB => {
  const connectionString = inject('sharedEventStoreDBConnectionString');

  return {
    connectionString,
    getClient: () => EventStoreDBClient.connectionString(connectionString),
  };
};
