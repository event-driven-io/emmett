import { sum, IllegalStateError, event } from '@event-driven-io/emmett'; console.log(typeof sum, typeof IllegalStateError, event('A', {a: 1}));
