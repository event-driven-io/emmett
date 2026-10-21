import { setup } from 'xstate';

export const machine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'inc' } | { type: 'dec' },
  },
}).createMachine({ context: { count: 0 }, on: { inc: {}, dec: {} } });
