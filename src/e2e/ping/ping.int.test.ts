import { testEventStores } from '../';

testEventStores.forEach((eventStore) =>
  describe(`${eventStore.type} Event Store`, () => {
    it('Should do ping pong successfully', async () => {
      const pong = await eventStore.diagnostics.ping();
      expect(pong).toBe('pong');
    });
  })
);
