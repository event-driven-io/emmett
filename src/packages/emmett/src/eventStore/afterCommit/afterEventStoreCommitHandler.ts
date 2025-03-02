import {
  type BatchRecordedMessageHandlerWithContext,
  type BatchRecordedMessageHandlerWithoutContext,
  type DefaultRecord,
  type Event,
  type ReadEvent,
} from '../../typing';
import type { EventStore, EventStoreReadEventMetadata } from '../eventStore';

export type AfterEventStoreCommitHandler<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = HandlerContext extends undefined
  ? BatchRecordedMessageHandlerWithoutContext<
      Event,
      EventStoreReadEventMetadata<Store>
    >
  : BatchRecordedMessageHandlerWithContext<
      Event,
      EventStoreReadEventMetadata<Store>,
      NonNullable<HandlerContext>
    >;

export type BeforeEventStoreCommitHandler<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = HandlerContext extends undefined
  ? BatchRecordedMessageHandlerWithoutContext<
      Event,
      EventStoreReadEventMetadata<Store>
    >
  : BatchRecordedMessageHandlerWithContext<
      Event,
      EventStoreReadEventMetadata<Store>,
      NonNullable<HandlerContext>
    >;

type TryPublishMessagesAfterCommitOptions<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = {
  onAfterCommit?: AfterEventStoreCommitHandler<Store, HandlerContext>;
};

export async function tryPublishMessagesAfterCommit<Store extends EventStore>(
  messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  options: TryPublishMessagesAfterCommitOptions<Store, undefined> | undefined,
): Promise<boolean>;
export async function tryPublishMessagesAfterCommit<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
>(
  messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  options:
    | TryPublishMessagesAfterCommitOptions<Store, HandlerContext>
    | undefined,
  context: HandlerContext,
): Promise<boolean>;
export async function tryPublishMessagesAfterCommit<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
>(
  messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  options:
    | TryPublishMessagesAfterCommitOptions<Store, HandlerContext>
    | undefined,
  context?: HandlerContext,
): Promise<boolean> {
  if (options?.onAfterCommit === undefined) return false;

  try {
    await options?.onAfterCommit(messages, context!);
    return true;
  } catch (error) {
    // TODO: enhance with tracing
    console.error(`Error in on after commit hook`, error);
    return false;
  }
}
