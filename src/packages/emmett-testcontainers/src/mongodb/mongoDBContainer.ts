import { MongoDBContainer } from '@testcontainers/mongodb';

export const getMongoDBContainer = (
  options: { version: string } = { version: '6.0.1' },
) => {
  return new MongoDBContainer(`mongo:${options.version}`);
};

export const getMongoDBStartedContainer = async (
  options: { version: string } = { version: '6.0.1' },
) => {
  const container = getMongoDBContainer(options);
  return container.start();
};
