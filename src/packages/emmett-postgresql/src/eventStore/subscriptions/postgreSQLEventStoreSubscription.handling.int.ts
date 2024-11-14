import { assertThatArray, type Event } from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import {
  PostgreSQLEventStoreSubscription,
  postgreSQLEventStoreSubscription,
} from './postgreSQLEventStoreSubscription';

void describe('PostgreSQL event store started subscriptions', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
  });

  after(async () => {
    try {
      await eventStore.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('eachMessage handles all events appended to event store after subscription was started', async () => {
    // Given
    const guestId = uuid();
    const streamName = `guestStay-${guestId}`;
    const events: GuestStayEvent[] = [
      { type: 'GuestCheckedIn', data: { guestId } },
      { type: 'GuestCheckedOut', data: { guestId } },
    ];
    await eventStore.appendToStream(streamName, events);

    const result: GuestStayEvent[] = [];

    // When
    const subscription = postgreSQLEventStoreSubscription<GuestStayEvent>({
      connectionString,
      eachMessage: (event) => {
        result.push(event);

        if (result.length === 2) {
          return PostgreSQLEventStoreSubscription.result.stop();
        }
      },
    });

    try {
      await subscription.subscribe();

      assertThatArray(result).containsElementsMatching(events);
    } finally {
      await subscription.stop();
    }
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
