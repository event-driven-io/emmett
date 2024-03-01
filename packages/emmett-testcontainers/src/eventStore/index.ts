import { EventStoreDBClient } from '@eventstore/db-client';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from './eventStoreDBContainer';

let esdbContainer: StartedEventStoreDBContainer;

export const getEventStoreDBTestClient = async (
  useTestContainers = false,
): Promise<EventStoreDBClient> => {
  let connectionString;

  if (useTestContainers) {
    if (!esdbContainer)
      esdbContainer = await new EventStoreDBContainer().start();

    connectionString = esdbContainer.getConnectionString();
  } else {
    // await compose.upAll();
    connectionString = 'esdb://localhost:2113?tls=false';
  }

  // That's how EventStoreDB client is setup
  // We're taking the connection string from container
  return EventStoreDBClient.connectionString(connectionString);
};
