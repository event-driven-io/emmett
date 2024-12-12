import { EventStoreDBClient } from '@eventstore/db-client';
import {
  AbstractStartedContainer,
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import type { Environment } from 'testcontainers/build/types';

export const EVENTSTOREDB_PORT = 2113;
export const EVENTSTOREDB_IMAGE_NAME = 'eventstore/eventstore';
export const EVENTSTOREDB_IMAGE_TAG = '23.10.1-bookworm-slim';
export const EVENTSTOREDB_ARM64_IMAGE_TAG = '23.10.1-alpha-arm64v8';

export const EVENTSTOREDB_DEFAULT_IMAGE = `${EVENTSTOREDB_IMAGE_NAME}:${process.arch !== 'arm64' ? EVENTSTOREDB_IMAGE_TAG : EVENTSTOREDB_ARM64_IMAGE_TAG}`;

export type EventStoreDBContainerOptions = {
  disableProjections?: boolean;
  isSecure?: boolean;
  useFileStorage?: boolean;
  withReuse?: boolean;
};

export const defaultEventStoreDBContainerOptions: EventStoreDBContainerOptions =
  {
    disableProjections: false,
    isSecure: false,
    useFileStorage: false,
    withReuse: false,
  };

export class EventStoreDBContainer extends GenericContainer {
  constructor(
    image = EVENTSTOREDB_DEFAULT_IMAGE,
    options: EventStoreDBContainerOptions = defaultEventStoreDBContainerOptions,
  ) {
    super(image);

    const environment: Environment = {
      ...(!options.disableProjections
        ? {
            EVENTSTORE_RUN_PROJECTIONS: 'ALL',
          }
        : {}),
      ...(!options.isSecure
        ? {
            EVENTSTORE_INSECURE: 'true',
          }
        : {}),
      ...(options.useFileStorage
        ? {
            EVENTSTORE_MEM_DB: 'false',
            EVENTSTORE_DB: '/data/integration-tests',
          }
        : {}),
      EVENTSTORE_CLUSTER_SIZE: '1',
      EVENTSTORE_START_STANDARD_PROJECTIONS: 'true',
      EVENTSTORE_NODE_PORT: `${EVENTSTOREDB_PORT}`,
      EVENTSTORE_ENABLE_ATOM_PUB_OVER_HTTP: 'true',
    };

    this.withEnvironment(environment).withExposedPorts(EVENTSTOREDB_PORT);

    if (options.withReuse) this.withReuse();

    this.withWaitStrategy(
      Wait.forAll([Wait.forHealthCheck(), Wait.forListeningPorts()]),
    );
  }

  async start(): Promise<StartedEventStoreDBContainer> {
    return new StartedEventStoreDBContainer(await super.start());
  }
}

export class StartedEventStoreDBContainer extends AbstractStartedContainer {
  constructor(container: StartedTestContainer) {
    super(container);
  }

  getConnectionString(): string {
    return `esdb://${this.getHost()}:${this.getMappedPort(2113)}?tls=false`;
  }

  getClient(): EventStoreDBClient {
    return EventStoreDBClient.connectionString(this.getConnectionString());
  }
}
let container: EventStoreDBContainer | null = null;
let startedContainer: StartedEventStoreDBContainer | null = null;
let startedCount = 0;

export const getSharedEventStoreDBTestContainer = async () => {
  if (startedContainer) return startedContainer;

  if (!container)
    container = new EventStoreDBContainer(EVENTSTOREDB_DEFAULT_IMAGE, {
      withReuse: true,
    });

  startedContainer = await container.start();
  startedCount++;

  container.withLogConsumer((stream) =>
    stream
      .on('data', (line) => console.log(line))
      .on('err', (line) => console.error(line))
      .on('end', () => console.log('Stream closed')),
  );

  return startedContainer;
};

export const getSharedTestEventStoreDBClient = async () => {
  return (await getSharedEventStoreDBTestContainer()).getClient();
};

export const releaseSharedEventStoreDBTestContainer = async () => {
  const containerToStop = startedContainer;
  if (containerToStop && --startedCount === 0) {
    try {
      startedContainer = null;
      container = null;
      await containerToStop.stop();
    } catch {
      /* do nothing */
    }
  }
};
