import {
  asyncRetry,
  EmmettError,
  IllegalStateError,
  JSONParser,
  type AnyMessage,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type CurrentMessageProcessorPosition,
  type Event,
  type Message,
  type MessageHandlerResult,
  type ReadEvent,
  type RecordedMessage,
  type RecordedMessageMetadata,
} from '@event-driven-io/emmett';
import {
  ChangeStream,
  Timestamp,
  type ChangeStreamInsertDocument,
  type ChangeStreamReplaceDocument,
  type ChangeStreamUpdateDocument,
  type Db,
  type Document,
  type MongoClient,
} from 'mongodb';
import { pipeline, Transform, Writable, type WritableOptions } from 'stream';
import type { MongoDBRecordedMessageMetadata } from '../../event';
import type {
  EventStream,
  MongoDBReadEventMetadata,
} from '../../mongoDBEventStore';
import { isMongoDBResumeToken, type MongoDBResumeToken } from './types';

export type MongoDBSubscriptionOptions<
  MessageType extends Message = Message,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  // CheckpointType = MongoDBResumeToken,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CheckpointType = any,
> = {
  from?: CurrentMessageProcessorPosition<CheckpointType>;
  client: MongoClient;
  // batchSize: number;
  eachBatch: BatchRecordedMessageHandlerWithoutContext<
    MessageType,
    MessageMetadataType
  >;
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};
export type ChangeStreamFullDocumentValuePolicy = () =>
  | 'whenAvailable'
  | 'updateLookup';
export type MongoDBSubscriptionDocument<TSchema extends Document = Document> =
  | ChangeStreamInsertDocument<TSchema>
  | ChangeStreamUpdateDocument<TSchema>
  | ChangeStreamReplaceDocument<TSchema>;
// https://www.mongodb.com/docs/manual/reference/command/buildInfo/
export type BuildInfo = {
  version: string;
  gitVersion: string;
  sysInfo: string;
  loaderFlags: string;
  compilerFlags: string;
  allocator: string;
  versionArray: number[];
  openssl: Document;
  javascriptEngine: string;
  bits: number;
  debug: boolean;
  maxBsonObjectSize: number;
  storageEngines: string[];
  ok: number;
};
export type MongoDBSubscriptionStartFrom<ResumeToken = MongoDBResumeToken> =
  CurrentMessageProcessorPosition<ResumeToken>;

export type MongoDBSubscriptionStartOptions<ResumeToken = MongoDBResumeToken> =
  {
    startFrom: MongoDBSubscriptionStartFrom<ResumeToken>;
    getFullDocumentValue: ChangeStreamFullDocumentValuePolicy;
    dbName?: string;
  };

export type MongoDBSubscription<ResumeToken = MongoDBResumeToken> = {
  isRunning: boolean;
  start(options: MongoDBSubscriptionStartOptions<ResumeToken>): Promise<void>;
  stop(): Promise<void>;
};

export type StreamSubscription<
  EventType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
> = ChangeStream<
  EventStream<Extract<EventType, { kind?: 'Event' }>, MessageMetadataType>,
  MongoDBSubscriptionDocument<
    EventStream<Extract<EventType, { kind?: 'Event' }>, RecordedMessageMetadata>
  >
>;
export type MessageArrayElement = `messages.${string}`;
export type UpdateDescription<T> = {
  _id: MongoDBResumeToken;
  operationType: 'update';
  updateDescription: {
    updatedFields: Record<MessageArrayElement, T> & {
      'metadata.streamPosition': number;
      'metadata.updatedAt': Date;
    };
  };
};
export type FullDocument<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
  T extends EventStream = EventStream<EventType, EventMetaDataType>,
> = {
  _id: MongoDBResumeToken;
  operationType: 'insert';
  fullDocument: T;
};
export type OplogChange<
  EventType extends Message = AnyMessage,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
  T extends EventStream = EventStream<
    Extract<EventType, { kind?: 'Event' }>,
    EventMetaDataType
  >,
> =
  | FullDocument<Extract<EventType, { kind?: 'Event' }>, EventMetaDataType, T>
  | UpdateDescription<
      ReadEvent<Extract<EventType, { kind?: 'Event' }>, EventMetaDataType>
    >;

type SubscriptionSequentialHandlerOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  CheckpointType = MongoDBResumeToken,
> = MongoDBSubscriptionOptions<
  MessageType,
  MessageMetadataType,
  CheckpointType
> &
  WritableOptions;

class SubscriptionSequentialHandler<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  CheckpointType = MongoDBResumeToken,
> extends Transform {
  private options: SubscriptionSequentialHandlerOptions<
    MessageType,
    MessageMetadataType,
    CheckpointType
  >;
  // private from: EventStoreDBEventStoreConsumerType | undefined;
  public isRunning: boolean;

  constructor(
    options: SubscriptionSequentialHandlerOptions<
      MessageType,
      MessageMetadataType,
      CheckpointType
    >,
  ) {
    super({ objectMode: true, ...options });
    this.options = options;
    // this.from = options.from;
    this.isRunning = true;
  }

  async _transform(
    change: OplogChange<MessageType, MessageMetadataType>,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      if (!this.isRunning || !change) {
        callback();
        return;
      }

      const messageCheckpoint = change._id;
      const streamChange =
        change.operationType === 'insert'
          ? change.fullDocument
          : change.operationType === 'update'
            ? {
                messages: Object.entries(change.updateDescription.updatedFields)
                  .filter(([key]) => key.startsWith('messages.'))
                  .map(([, value]) => value as ReadEvent),
              }
            : void 0;

      if (!streamChange) {
        return;
      }

      const messages = streamChange.messages.map((message) => {
        return {
          kind: message.kind,
          type: message.type,
          data: message.data,
          metadata: {
            ...message.metadata,
            globalPosition: messageCheckpoint,
          },
        } as unknown as RecordedMessage<MessageType, MessageMetadataType>;
      });

      const result = await this.options.eachBatch(messages);

      if (result && result.type === 'STOP') {
        this.isRunning = false;
        if (!result.error) this.push(messageCheckpoint);

        this.push(result);
        this.push(null);
        callback();
        return;
      }

      this.push(messageCheckpoint);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

const REGEXP =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const isDatabaseUnavailableError = (error: unknown) =>
  error instanceof Error &&
  'type' in error &&
  error.type === 'unavailable' &&
  'code' in error &&
  error.code === 14;

export const MongoDBResubscribeDefaultOptions: AsyncRetryOptions = {
  forever: true,
  minTimeout: 100,
  factor: 1.5,
  shouldRetryError: (error) => !isDatabaseUnavailableError(error),
};

export const parseSemVer = (value: string = '') => {
  const versions = REGEXP.exec(value);

  return {
    major: Number(versions?.[1]) || void 0,
    minor: Number(versions?.[2]) || void 0,
    bugfix: Number(versions?.[3]) || void 0,
    rc: versions?.[4] || void 0,
  };
};

export const generateVersionPolicies = async (db: Db) => {
  const buildInfo = (await db.admin().buildInfo()) as BuildInfo;
  const semver = parseSemVer(buildInfo.version);
  const major = semver.major || 0;
  const throwNotSupportedError = (): never => {
    throw new EmmettError(
      `Not supported MongoDB version: ${buildInfo.version}.`,
    );
  };

  const supportedVersionCheckPolicy = () => {
    if (major < 5) {
      throwNotSupportedError();
    }
  };
  const changeStreamFullDocumentValuePolicy: ChangeStreamFullDocumentValuePolicy =
    () => {
      if (major >= 6) {
        return 'whenAvailable';
      } else if (major === 5) {
        return 'updateLookup';
      } else {
        throw new EmmettError(`Major number is ${major}`);
      }
    };

  return {
    supportedVersionCheckPolicy,
    changeStreamFullDocumentValuePolicy,
  };
};

// const DEFAULT_PARTITION_KEY_NAME = 'default';
const createChangeStream = <
  EventType extends Message = AnyMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CheckpointType = any,
>(
  getFullDocumentValue: ChangeStreamFullDocumentValuePolicy,
  db: Db,
  resumeToken?: CurrentMessageProcessorPosition<CheckpointType>,
  // partitionKey: string = DEFAULT_PARTITION_KEY_NAME,
) => {
  const $match = {
    'ns.coll': { $regex: /^emt:/, $ne: 'emt:processors' },
    $or: [
      { operationType: 'insert' },
      {
        operationType: 'update',
      },
    ],
    // 'fullDocument.partitionKey': partitionKey,
  };
  const pipeline = [
    {
      $match,
    },
  ];

  return db.watch<
    EventStream<Extract<EventType, { kind?: 'Event' }>>,
    MongoDBSubscriptionDocument<
      EventStream<Extract<EventType, { kind?: 'Event' }>>
    >
  >(pipeline, {
    fullDocument: getFullDocumentValue(),
    ...(resumeToken === 'BEGINNING'
      ? {
          /*
            The MongoDB's API is designed around starting from now or resuming from a known position
            (resumeAfter, startAfter, or startAtOperationTime).
            By passing a date set a long time ago (year 2000), we force MongoDB to start
            from the earliest possible position in the oplog.
            If the retention is 48 hours, then it will be 24 hours back.
          */
          startAtOperationTime: new Timestamp({
            t: 946684800,
            i: 0,
          }),
        }
      : resumeToken === 'END'
        ? void 0
        : resumeToken?.lastCheckpoint),
  });
};

const subscribe =
  (getFullDocumentValue: ChangeStreamFullDocumentValuePolicy, db: Db) =>
  <EventType extends Message = AnyMessage, CheckpointType = MongoDBResumeToken>(
    resumeToken?: MongoDBSubscriptionStartFrom<CheckpointType>,
  ) => {
    return createChangeStream<EventType>(getFullDocumentValue, db, resumeToken);
  };

export const mongoDBSubscription = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  ResumeToken = MongoDBResumeToken,
>({
  client,
  from,
  // batchSize,
  eachBatch,
  resilience,
}: MongoDBSubscriptionOptions<
  MessageType,
  MessageMetadataType
>): MongoDBSubscription<ResumeToken> => {
  let isRunning = false;

  let start: Promise<void>;
  let processor: SubscriptionSequentialHandler<
    MessageType,
    MessageMetadataType
  >;

  let subscription: StreamSubscription<MessageType, MessageMetadataType>;

  const resubscribeOptions: AsyncRetryOptions =
    resilience?.resubscribeOptions ?? {
      ...MongoDBResubscribeDefaultOptions,
      shouldRetryResult: () => isRunning,
      shouldRetryError: (error) =>
        isRunning && MongoDBResubscribeDefaultOptions.shouldRetryError!(error),
    };

  const stopSubscription = async (callback?: () => void): Promise<void> => {
    isRunning = false;
    if (processor) processor.isRunning = false;

    if (subscription.closed) {
      return new Promise((resolve, reject) => {
        try {
          callback?.();
          resolve();
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : typeof error === 'string'
                ? new Error(error)
                : new Error('Unknown error'),
          );
        }
      });
    } else {
      try {
        await subscription.close();
      } finally {
        callback?.();
      }
    }
  };

  const pipeMessages = (
    options: MongoDBSubscriptionStartOptions<ResumeToken>,
  ) => {
    let retry = 0;

    return asyncRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          console.info(
            `Starting subscription. ${retry++} retries. From: ${JSONParser.stringify(from ?? '$all')}, Start from: ${JSONParser.stringify(
              options.startFrom,
            )}`,
          );
          subscription = subscribe(
            options.getFullDocumentValue,
            client.db(options.dbName),
          )<MessageType, ResumeToken>(options.startFrom);

          processor = new SubscriptionSequentialHandler<
            MessageType,
            MessageMetadataType
          >({
            client,
            from,
            // batchSize,
            eachBatch,
            resilience,
          });

          const handler = new (class extends Writable {
            async _write(
              result: MongoDBResumeToken | MessageHandlerResult,
              _encoding: string,
              done: () => void,
            ) {
              if (!isRunning) return;

              if (isMongoDBResumeToken(result)) {
                options.startFrom = {
                  lastCheckpoint: result as ResumeToken,
                };
                done();
                return;
              }

              if (result && result.type === 'STOP' && result.error) {
                console.error(
                  `Subscription stopped with error code: ${result.error.errorCode}, message: ${
                    result.error.message
                  }.`,
                );
              }

              await stopSubscription();
              done();
            }
          })({ objectMode: true });

          pipeline(
            subscription,
            processor,
            handler,
            async (error: Error | null) => {
              console.info(`Stopping subscription.`);
              await stopSubscription(() => {
                if (!error) {
                  console.info('Subscription ended successfully.');
                  resolve();
                  return;
                }

                if (
                  error.message === 'ChangeStream is closed' &&
                  error.name === 'MongoAPIError'
                ) {
                  console.info('Subscription ended successfully.');
                  resolve();
                  return;
                }

                console.error(
                  `Received error: ${JSONParser.stringify(error)}.`,
                );
                reject(error);
              });
            },
          );

          console.log('OK');
        }),
      resubscribeOptions,
    );
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: (options) => {
      if (isRunning) return start;

      start = (async () => {
        isRunning = true;
        return pipeMessages(options);
      })();

      return start;
    },
    stop: async () => {
      if (!isRunning) return start ? await start : Promise.resolve();
      await stopSubscription();
      await start;
    },
  };
};

/**
 * Compares two MongoDB Resume Tokens.
 * @param token1 Token 1.
 * @param token2 Token 2.
 * @returns 0 - if the tokens are the same, 1 - if the token1 is later, -1 - is the token1 is earlier.
 */
const compareTwoMongoDBTokens = (
  token1: MongoDBResumeToken,
  token2: MongoDBResumeToken,
) => {
  const bufA = Buffer.from(token1._data, 'hex');
  const bufB = Buffer.from(token2._data, 'hex');

  return Buffer.compare(bufA, bufB);
};

const compareTwoTokens = (token1: unknown, token2: unknown) => {
  if (token1 === null && token2) {
    return -1;
  }

  if (token1 && token2 === null) {
    return 1;
  }

  if (token1 === null && token2 === null) {
    return 0;
  }

  if (isMongoDBResumeToken(token1) && isMongoDBResumeToken(token2)) {
    return compareTwoMongoDBTokens(token1, token2);
  }

  throw new IllegalStateError(`Type of tokens is not comparable`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zipMongoDBMessageBatchPullerStartFrom = <CheckpointType = any>(
  options: (CurrentMessageProcessorPosition<CheckpointType> | undefined)[],
): CurrentMessageProcessorPosition<CheckpointType> => {
  if (
    options.length === 0 ||
    options.some((o) => o === undefined || o === 'BEGINNING')
  ) {
    return 'BEGINNING';
  }

  if (options.every((o) => o === 'END')) {
    return 'END';
  }

  const positionTokens = options.filter(
    (o) => o !== undefined && o !== 'BEGINNING' && o !== 'END',
  );

  const sorted = positionTokens.sort((a, b) => {
    return compareTwoTokens(a.lastCheckpoint, b.lastCheckpoint);
  });

  return sorted[0]!;
};

export {
  compareTwoMongoDBTokens,
  compareTwoTokens,
  subscribe,
  zipMongoDBMessageBatchPullerStartFrom,
};
