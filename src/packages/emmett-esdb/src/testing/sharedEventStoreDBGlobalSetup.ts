import {
  EventStoreDBContainer,
  type StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import type { TestProject } from 'vitest/node';

let container: StartedEventStoreDBContainer | undefined;

export const setup = async (project: TestProject): Promise<void> => {
  container = await new EventStoreDBContainer().start();

  project.provide(
    'sharedEventStoreDBConnectionString',
    container.getConnectionString(),
  );
};

export const teardown = async (): Promise<void> => {
  await container?.stop();
  container = undefined;
};
