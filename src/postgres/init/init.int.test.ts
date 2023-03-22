import { getPostgresEventStore } from '../';

describe('In Memory Event Store', () => {
  const eventStore = getPostgresEventStore({
    type: 'postgres',
    connectionString: 'dummy',
  });

  it('Should do nothing when init is called', async () => {
    await expect(eventStore.init()).resolves.not.toThrow();
  });
});
