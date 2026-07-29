import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { TestProject } from 'vitest/node';

let container: StartedMongoDBContainer | undefined;

export const setup = async (project: TestProject): Promise<void> => {
  container = await getMongoDBStartedContainer();

  project.provide(
    'sharedMongoDBConnectionString',
    container.getConnectionString(),
  );
};

export const teardown = async (): Promise<void> => {
  await container?.stop();
  container = undefined;
};
