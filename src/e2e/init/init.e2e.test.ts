import { getTestEventStores } from '..';

getTestEventStores().forEach((eventStore) =>
  describe(`${eventStore.type} Event Store`, () => {
    it('Should do nothing when init is called', async () => {
      await expect(eventStore.init()).resolves.not.toThrow();
    });
  })
);
