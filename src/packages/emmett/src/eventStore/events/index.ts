import {
  event,
  type Event,
  type EventDataOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '../../typing';

export const GlobalStreamCaughtUpType = '__emt:GlobalStreamCaughtUp';

export type GlobalStreamCaughtUp = Event<
  '__emt:GlobalStreamCaughtUp',
  { globalPosition: bigint },
  { globalPosition: bigint }
>;

export const isGlobalStreamCaughtUp = (
  event: Event,
): event is GlobalStreamCaughtUp => event.type === GlobalStreamCaughtUpType;

export const caughtUpEventFrom =
  (position: bigint) =>
  (
    event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
  ): event is ReadEvent<
    GlobalStreamCaughtUp,
    ReadEventMetadataWithGlobalPosition
  > =>
    event.type === GlobalStreamCaughtUpType &&
    event.metadata?.globalPosition >= position;

export const globalStreamCaughtUp = (
  data: EventDataOf<GlobalStreamCaughtUp>,
): GlobalStreamCaughtUp =>
  event<GlobalStreamCaughtUp>(GlobalStreamCaughtUpType, data, {
    globalPosition: data.globalPosition,
  });

export const isSubscriptionEvent = (
  event: Event,
): event is GlobalSubscriptionEvent => isGlobalStreamCaughtUp(event);

export const isNotInternalEvent = (event: Event): boolean =>
  !isGlobalStreamCaughtUp(event);

export type GlobalSubscriptionEvent = GlobalStreamCaughtUp;
