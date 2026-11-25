import { describe, it } from 'vitest';
import { CommandHandler } from '../commandHandling';
import {
  getInMemoryEventStore,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
} from '../eventStore';
import type { Event } from '../typing';
import { assertDeepEqual, assertMatches } from './assertions';
import { WrapEventStore } from './wrapEventStore';

type SomethingHappened = Event<'Did', { something: string }>;

type Entity = { something: string };

const initialState = (): Entity => ({ something: 'Meh' });

const evolve = (_entity: Entity, _event: SomethingHappened): Entity => ({
  something: 'Nothing',
});

const handle = CommandHandler<Entity, SomethingHappened>({
  evolve,
  initialState,
});

const event: SomethingHappened = {
  type: 'Did',
  data: { something: 'Yes!' },
};

/**
 * Mirrors a store that opens a session per command - PostgreSQL does this. The
 * session yields its own store instance, not the one the caller was holding.
 */
const withSessionSupport = <Store extends EventStore>(
  eventStore: Store,
): Store & EventStoreSessionFactory<Store> => ({
  ...eventStore,
  withSession: (callback) =>
    callback({ eventStore, close: () => Promise.resolve() }),
});

void describe('WrapEventStore', () => {
  void it('records events appended by a command handler', async () => {
    const eventStore = WrapEventStore(getInMemoryEventStore());

    await handle(eventStore, 'stream-1', () => [event]);

    assertMatches(Array.from(eventStore.appendedEvents.values()), [
      ['stream-1', [event]],
    ]);
  });

  void it('records events appended by a command handler through a session', async () => {
    const eventStore = WrapEventStore(
      withSessionSupport(getInMemoryEventStore()),
    );

    await handle(eventStore, 'stream-2', () => [event]);

    assertMatches(Array.from(eventStore.appendedEvents.values()), [
      ['stream-2', [event]],
    ]);
  });

  void it('passes the session options to the wrapped store', async () => {
    const inner = getInMemoryEventStore();
    const receivedOptions: unknown[] = [];
    const eventStore = WrapEventStore({
      ...inner,
      withSession: <T>(
        callback: (session: EventStoreSession<typeof inner>) => Promise<T>,
        options?: { transaction: string },
      ): Promise<T> => {
        receivedOptions.push(options);
        return callback({
          eventStore: inner,
          close: () => Promise.resolve(),
        });
      },
    });

    await eventStore.withSession(() => Promise.resolve(), {
      transaction: 'opened by the caller',
    });

    assertDeepEqual(receivedOptions, [{ transaction: 'opened by the caller' }]);
  });
});
