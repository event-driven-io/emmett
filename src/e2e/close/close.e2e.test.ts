import { getTestEventStores } from '..';

getTestEventStores().forEach((eventStore) =>
  describe(`${eventStore.type} Event Store`, () => {
    it('Should fail to do ping pong after close', async () => {
      await eventStore.close();

      await expect(() => eventStore.diagnostics.ping()).rejects.toThrow(
        'Event Store is already closed. You need to create a new one'
      );
    });

    it('Should fail to do init after close', async () => {
      await eventStore.close();

      await expect(() => eventStore.init()).rejects.toThrow(
        'Event Store is already closed. You need to create a new one'
      );
    });

    it('Should ignore close again after close', async () => {
      await eventStore.close();

      try {
        await eventStore.close();
      } catch {
        expect(true).toBeFalsy();
      }
    });
  })
);
