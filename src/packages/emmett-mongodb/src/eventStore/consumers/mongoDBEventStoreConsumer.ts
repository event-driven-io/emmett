import { EmmettError, type Message } from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import {
  mongoDBEventStoreProcessor,
  type MongoDBEventStoreProcessor,
  type MongoDBEventStoreProcessorOptions,
} from './mongoDBEventStoreProcessor';

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

export function mongoDBEventStoreConsumer<
  ConsumerMessageType extends Message = Message,
>(options: MongoDBEventStoreConsumerOptions<ConsumerMessageType>) {
  return new MongoDBEventStoreConsumer<ConsumerMessageType>(options);
}

export type MongoDBEventStoreConsumerOptions<MessageType extends Message> = {
  client: MongoClient;
  processors?: MongoDBEventStoreProcessor<MessageType>[];
};

export class MongoDBEventStoreConsumer<ConsumerMessageType extends Message> {
  #isRunning: boolean;
  #start: Promise<void>;

  private subscription: MongoDBEventStoreMessageSubscription;
  private currentSubscription: MongoDBEventStoreMessageSubscription | undefined;
  private processors: MongoDBEventStoreProcessor<ConsumerMessageType>[];

  constructor(
    private options: MongoDBEventStoreConsumerOptions<ConsumerMessageType>,
  ) {
    this.#isRunning = false;
    this.#start = Promise.resolve();
    this.processors = options.processors ?? [];

    this.subscription = mongoDBEventStoreSubscription({
      client,
      // TODO:
    });
    this.currentSubscription = this.subscription;
  }

  get isRunning() {
    return this.#isRunning;
  }

  // TODO:
  async start() {
    if (this.#isRunning) {
      return this.#start;
    }

    this.#start = (async () => {
      if (this.processors.length === 0) {
        new EmmettError(
          'Cannot start consumer without at least a single processor',
        );
      }

      this.#isRunning = true;

      return this.subscription.start();
    })();

    return this.#start;
    throw new Error('TODO');
  }

  async stop() {
    if (this.#isRunning) {
      return;
    }
    if (this.currentSubscription) {
      await this.currentSubscription.stop();
      this.currentSubscription = undefined;
    }
    this.#isRunning = false;
    await this.#start;
  }

  async close() {
    await this.stop();
  }

  processor<MessageType extends ConsumerMessageType = ConsumerMessageType>(
    options: MongoDBEventStoreProcessorOptions<MessageType>,
  ): MongoDBEventStoreProcessor<MessageType> {
    const processor = mongoDBEventStoreProcessor<MessageType>(options);
    this.processors.push(processor as MongoDBEventStoreProcessor);
    return processor;
  }
}
