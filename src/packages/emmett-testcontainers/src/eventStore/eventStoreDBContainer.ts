import { EventStoreDBClient } from '@eventstore/db-client';
import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
} from 'testcontainers';
import type { Environment } from 'testcontainers/build/types';

export const EVENTSTOREDB_PORT = 2113;
export const EVENTSTOREDB_TCP_PORT = 1113;
export const EVENTSTOREDB_TCP_PORTS = [
  EVENTSTOREDB_TCP_PORT,
  EVENTSTOREDB_PORT,
];
export const EVENTSTOREDB_IMAGE_NAME = 'eventstore/eventstore';
export const EVENTSTOREDB_IMAGE_TAG = '23.10.1-bookworm-slim';
export const EVENTSTOREDB_ARM64_IMAGE_TAG = '23.10.1-alpha-arm64v8';

export const EVENTSTOREDB_DEFAULT_IMAGE = `${EVENTSTOREDB_IMAGE_NAME}:${process.arch !== 'arm64' ? EVENTSTOREDB_IMAGE_TAG : EVENTSTOREDB_ARM64_IMAGE_TAG}`;

export type EventStoreDBContainerOptions = {
  disableProjections?: boolean;
  isSecure?: boolean;
  useFileStorage?: boolean;
  withoutReuse?: boolean;
};

export const defaultEventStoreDBContainerOptions: EventStoreDBContainerOptions =
  {
    disableProjections: false,
    isSecure: false,
    useFileStorage: false,
    withoutReuse: false,
  };

export class EventStoreDBContainer extends GenericContainer {
  private readonly tcpPorts = EVENTSTOREDB_TCP_PORTS;

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
      EVENTSTORE_EXT_TCP_PORT: `${EVENTSTOREDB_TCP_PORT}`,
      EVENTSTORE_HTTP_PORT: `${EVENTSTOREDB_PORT}`,
      EVENTSTORE_ENABLE_EXTERNAL_TCP: 'true',
      EVENTSTORE_ENABLE_ATOM_PUB_OVER_HTTP: 'true',
    };

    this.withEnvironment(environment).withExposedPorts(...this.tcpPorts);

    if (!options.withoutReuse) this.withReuse();
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
