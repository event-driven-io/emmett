import { getSQLiteEventStore } from '../';

describe('In Memory Event Store', () => {
  const eventStore = getSQLiteEventStore({
    type: 'sqlite',
    connectionString: 'dummy',
  });

  it('Should do nothing when init is called', async () => {
    await expect(eventStore.init()).resolves.not.toThrow();
  });
});
