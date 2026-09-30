import {
  LogEvent,
  noopScope,
  type ObservabilityScope,
} from '@event-driven-io/almanac';
import { EmmettAttributes, EmmettSpans } from '../../observability/attributes';
import type {
  BatchRecordedMessageHandlerWithContext,
  BatchRecordedMessageHandlerWithoutContext,
  DefaultRecord,
  Event,
  ReadEvent,
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
  observabilityScope?: ObservabilityScope;
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
    TryPublishMessagesAfterCommitOptions<Store, HandlerContext> | undefined,
  context: HandlerContext,
): Promise<boolean>;
export async function tryPublishMessagesAfterCommit<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
>(
  messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  options:
    TryPublishMessagesAfterCommitOptions<Store, HandlerContext> | undefined,
  context?: HandlerContext,
): Promise<boolean> {
  const onAfterCommit = options?.onAfterCommit;
  if (onAfterCommit === undefined) return false;

  const attributes = {
    [EmmettAttributes.stream.name]: messages[0]?.metadata.streamName,
    [EmmettAttributes.eventStore.append.batchSize]: messages.length,
  };

  return (options?.observabilityScope ?? noopScope)
    .scope(
      EmmettSpans.eventStore.onAfterCommit,
      async (scope) => {
        try {
          await onAfterCommit(messages, context!);
          return true;
        } catch (error) {
          scope.log(
            LogEvent(
              'emmett.eventstore.hooks.on_after_commit.exception',
              {
                body: 'onAfterCommit hook failed',
                error: error as Error,
                attributes,
              },
              { level: 'error' },
            ),
          );
          throw error;
        }
      },
      { attributes },
    )
    .catch(() => false);
}
