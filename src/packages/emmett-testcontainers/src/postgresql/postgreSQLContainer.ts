import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const getPostgreSQLContainer = (
  options: { version: string } = { version: '18.1' },
) => {
  return new PostgreSqlContainer(`postgres:${options.version}`);
};

export const getPostgreSQLStartedContainer = async (
  options: { version: string } = { version: '18.1' },
) => {
  const container = getPostgreSQLContainer(options);
  return container.start();
};
