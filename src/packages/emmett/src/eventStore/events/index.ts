import { type Event } from '../../typing';

export type GlobalStreamCaughtUp = Event<
  '__emt:GlobalStreamCaughtUp',
  { globalPosition: bigint }
>;

export const isGlobalStreamCaughtUp = (
  event: Event,
): event is GlobalStreamCaughtUp => event.type === '__emt:GlobalStreamCaughtUp';

export const isSubscriptionEvent = (
  event: Event,
): event is GlobalSubscriptionEvent => isGlobalStreamCaughtUp(event);

export const isNotSubscriptionEvent = (event: Event): boolean =>
  !isGlobalStreamCaughtUp(event);

export type GlobalSubscriptionEvent = GlobalStreamCaughtUp;
