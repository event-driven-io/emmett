import { evolve, initialState } from '~/counter';
import { eventStore } from '~/event-store';

export default eventHandler(async (event) => {
  const streamId = getRouterParam(event, 'streamId');
  if (!streamId) {
    setResponseStatus(event, 400);
    return sendError(event, new Error('Stream id not provided!'));
  }
  const { state } = await eventStore.aggregateStream(streamId, {
    evolve,
    initialState,
  });

  return state;
});
