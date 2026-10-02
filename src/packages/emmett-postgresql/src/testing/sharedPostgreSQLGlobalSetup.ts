import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { TestProject } from 'vitest/node';
import { acquireContainer, releaseContainer } from './sharedContainer';

export const setup = async (project: TestProject): Promise<void> => {
  const container = await acquireContainer('postgresql', () =>
    getPostgreSQLStartedContainer(),
  );

  project.provide(
    'sharedPostgreSQLConnectionString',
    container.getConnectionUri(),
  );
};

export const teardown = (): Promise<void> => releaseContainer('postgresql');
