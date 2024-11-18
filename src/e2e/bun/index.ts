import { getInMemoryEventStore, type Event } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const incremented: Event<'incremented'> = {
  type: 'incremented',
  data: {},
};

const decremented: Event<'decremented'> = {
  type: 'decremented',
  data: {},
};

type Counter = {
  value: number;
};

type CounterEvent = typeof incremented | typeof decremented;

eventStore.appendToStream('counter-1', [
  incremented,
  incremented,
  decremented,
  incremented,
  decremented,
]);

const evolve = (state: Counter, event: CounterEvent): Counter => {
  switch (event.type) {
    case 'incremented':
      return {
        value: state.value + 1,
      };
    case 'decremented':
      return {
        value: state.value - 1,
      };
    default:
      return state;
  }
};

const state = await eventStore.aggregateStream('counter-1', {
  evolve,
  initialState: () => ({
    value: 0,
  }),
});

console.log(state);
