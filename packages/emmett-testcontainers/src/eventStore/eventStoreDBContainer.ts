import { EventStoreDBClient } from '@eventstore/db-client';
import {
  AbstractStartedContainer,
  GenericContainer,
  type StartedTestContainer,
} from 'testcontainers';
import type { Environment } from 'testcontainers/build/types';

const EVENTSTOREDB_PORT = 2113;
const EVENTSTOREDB_TCP_PORT = 1113;
const EVENTSTOREDB_TCP_PORTS = [EVENTSTOREDB_TCP_PORT, EVENTSTOREDB_PORT];
const EVENTSTOREDB_IMAGE_NAME = 'eventstore/eventstore';
const EVENTSTOREDB_IMAGE_TAG = '23.10.1-bookworm-slim';

export class EventStoreDBContainer extends GenericContainer {
  private readonly tcpPorts = EVENTSTOREDB_TCP_PORTS;

  constructor(
    image = `${EVENTSTOREDB_IMAGE_NAME}:${EVENTSTOREDB_IMAGE_TAG}`,
    runProjections = true,
    isInsecure = true,
    emptyDatabase = true,
    withoutReuse = false,
  ) {
    super(image);

    const environment: Environment = {
      ...(runProjections
        ? {
            EVENTSTORE_RUN_PROJECTIONS: 'ALL',
          }
        : {}),
      ...(isInsecure
        ? {
            EVENTSTORE_INSECURE: 'true',
          }
        : {}),
      ...(!emptyDatabase
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

    if (!withoutReuse) this.withReuse();
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
    return `esdb://${this.getHost()}:${this.getMappedPort(
      2113,
    )}?tls=false&throwOnAppendFailure=false`;
  }

  getClient(): EventStoreDBClient {
    return EventStoreDBClient.connectionString(this.getConnectionString());
  }
}
