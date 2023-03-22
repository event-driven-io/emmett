import { getInMemoryEventStore } from '../';

describe('In Memory Event Store', () => {
  const eventStore = getInMemoryEventStore({ type: 'inMemory' });

  it('Should do nothing when init is called', async () => {
    await expect(eventStore.init()).resolves.not.toThrow();
  });
});
