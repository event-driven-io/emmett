import type { Message, EmmettError } from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import { v4 as uuid } from 'uuid';

export type MongoDBEventStoreProcessor<MessageType extends Message = Message> =
  {
    id: string;
    isActive: Readonly<boolean>;
    start: (client: MongoClient) => Promise<MongoDBSubscriptionStartFrom>;
    handle: (
      messages: MessageType[],
      context: { client: MongoClient },
    ) => Promise<MongoDBEventStoreProcessorMessageHandlerResult>;
  };

export type MongoDBSubscriptionStartFrom = 'BEGINNING';

export type MongoDBEventStoreProcessorMessageHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export function mongoDBEventStoreProcessor<MessageType extends Message>(
  options: MongoDBEventStoreProcessorOptions<MessageType>,
) {
  const processor = new MongoDBEventStoreProcessorClass<MessageType>(options);
  return processor;
}

export type MongoDBEventStoreProcessorOptions<MessageType extends Message> = {
  processorId?: string;
  version?: number;
  startFrom?: MongoDBSubscriptionStartFrom;
  stopAfter?: (message: MessageType) => boolean;
  eachMessage: MongoDBEventStoreProcessorEachMessageHandler<MessageType>;
};

export type MongoDBEventStoreProcessorEachMessageHandler<
  MessageType extends Message,
> = (
  message: MessageType,
) =>
  | Promise<MongoDBEventStoreProcessorMessageHandlerResult>
  | MongoDBEventStoreProcessorMessageHandlerResult;

export class MongoDBEventStoreProcessorClass<MessageType extends Message>
  implements MongoDBEventStoreProcessor<MessageType>
{
  #isActive: boolean;

  public id: string;

  constructor(private options: MongoDBEventStoreProcessorOptions<MessageType>) {
    this.id = options.processorId ?? uuid();
    this.#isActive = false;
  }

  get isActive() {
    return this.#isActive;
  }

  async start(client: MongoClient): Promise<MongoDBSubscriptionStartFrom> {
    this.#isActive = true;
    if (this.options.startFrom) {
      return this.options.startFrom;
    }

    return 'BEGINNING';
  }

  async handle(
    messages: MessageType[],
    context: { client: MongoClient },
  ): Promise<MongoDBEventStoreProcessorMessageHandlerResult> {
    if (!this.#isActive) {
      return;
    }

    let result: MongoDBEventStoreProcessorMessageHandlerResult | undefined;
    for (const message of messages) {
      result = await this.options.eachMessage(message);

      if (result && result.type === 'STOP') {
        this.#isActive = false;
        return result;
      }

      if (this.options.stopAfter && this.options.stopAfter(message)) {
        this.#isActive = false;
        return {
          type: 'STOP',
          reason: 'Stop condition reached',
        };
      }
    }

    return result;
  }
}
