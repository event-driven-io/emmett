import type { Message } from '@event-driven-io/emmett';

export type MongoDBEventStoreConsumerSubscription<MessageType extends Message> =
  {
    canHandle: MessageType['type'][];
    handle: (messages: MessageType[]) => void | Promise<void>;
  };

/**
 * The `MongoDBEventStoreConsumer` allows you to subscribe handlers to be called when messages are published to the consumer.
 *
 * @example
 *
 * ```typescript
 * import {
 *     getMongoDBEventStore,
 *     MongoDBEventStoreConsumer,
 * } from '@event-driven-io/emmett-mongodb';
 *
 * const consumer = new MongoDBEventStoreConsumer()
 *     .subscribe({
 *         canHandle: ['MyEventType'],
 *         handle: (messages) => {
 *             // handle messages ...
 *         },
 *     })
 *     .subscribe({
 *         canHandle: ['AnotherEventType'],
 *         handle: (messages) => {
 *             // handle messages ...
 *         },
 *     })
 *
 * const eventStore = getMongoDBEventStore({
 *     // ...,
 *     hooks: {
 *         onAfterCommit: (events) => {
 *             consumer.publish(events);
 *         },
 *     },
 * })
 */
export class MongoDBEventStoreConsumer<MessageType extends Message> {
  private subscriptions: MongoDBEventStoreConsumerSubscription<MessageType>[];

  constructor() {
    this.subscriptions = [];
  }

  publish<MessageType extends Message>(messages: MessageType[]) {
    for (const subscription of this.subscriptions) {
      const messagesSubscriptionCanHandle = filterMessagesByType(
        messages,
        subscription.canHandle,
      );

      if (messagesSubscriptionCanHandle.length < 0) {
        continue;
      }

      // TODO: should this be ran asynchronoously or awaited?
      subscription.handle(messagesSubscriptionCanHandle);
    }

    return this;
  }

  subscribe(subscription: MongoDBEventStoreConsumerSubscription<MessageType>) {
    this.subscriptions.push(subscription);
    return this;
  }
}

export function filterMessagesByType<
  IncomingMessageType extends Message,
  ExpectedMessageType extends Message,
>(
  messages: IncomingMessageType[],
  types: ExpectedMessageType['type'][],
): ExpectedMessageType[] {
  // @ts-expect-error The `type` parameter is how we determine whether or not the `message` is an `ExpectedMessageType`
  return messages.filter((m) => types.includes(m.type));
}
