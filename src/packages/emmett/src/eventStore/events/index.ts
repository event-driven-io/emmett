import { event, type Event, type EventDataOf } from '../../typing';

export const GlobalStreamCaughtUpType = '__emt:GlobalStreamCaughtUp';

export type GlobalStreamCaughtUp = Event<
  '__emt:GlobalStreamCaughtUp',
  { globalPosition: bigint }
>;

export const isGlobalStreamCaughtUp = (
  event: Event,
): event is GlobalStreamCaughtUp => event.type === GlobalStreamCaughtUpType;

export const globalStreamCaughtUp = (
  data: EventDataOf<GlobalStreamCaughtUp>,
): GlobalStreamCaughtUp =>
  event<GlobalStreamCaughtUp>(GlobalStreamCaughtUpType, data);

export const isSubscriptionEvent = (
  event: Event,
): event is GlobalSubscriptionEvent => isGlobalStreamCaughtUp(event);

export const isNotInternalEvent = (event: Event): boolean =>
  !isGlobalStreamCaughtUp(event);

export type GlobalSubscriptionEvent = GlobalStreamCaughtUp;
