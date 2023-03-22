import { getPostgresEventStore } from '../';

describe('In Memory Event Store', () => {
  const eventStore = getPostgresEventStore({
    type: 'postgres',
    poolConfig: {
      host: 'localhost',
      user: 'postgres',
      password: 'Password12!',
    },
  });

  it('Should do nothing when init is called', async () => {
    await expect(eventStore.init()).resolves.not.toThrow();
  });
});
