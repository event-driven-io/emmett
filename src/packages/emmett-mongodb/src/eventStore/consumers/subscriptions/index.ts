import {
  asyncRetry,
  EmmettError,
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
import type {
  EventStream,
  MongoDBReadEventMetadata,
} from '../../mongoDBEventStore';
import type { MongoDBChangeStreamMessageMetadata } from '../mongoDBEventStoreConsumer';
import {
  isMongoDBCheckpoint,
  toMongoDBCheckpoint,
  toMongoDBResumeToken,
  type MongoDBCheckpoint,
  type MongoDBResumeToken,
} from './mongoDBCheckpoint';

export type MongoDBSubscriptionOptions<MessageType extends Message = Message> =
  {
    from?: CurrentMessageProcessorPosition<MongoDBCheckpoint>;
    client: MongoClient;
    // batchSize: number;
    eachBatch: BatchRecordedMessageHandlerWithoutContext<
      MessageType,
      MongoDBChangeStreamMessageMetadata
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
export type MongoDBSubscriptionStartFrom =
  CurrentMessageProcessorPosition<MongoDBCheckpoint>;

export type MongoDBSubscriptionStartOptions = {
  startFrom: MongoDBSubscriptionStartFrom;
  dbName?: string;
};

export type MongoDBSubscription = {
  isRunning: boolean;
  start(options: MongoDBSubscriptionStartOptions): Promise<void>;
  stop(): Promise<void>;
};

export type StreamSubscription<
  EventType extends Message = AnyMessage,
  MessageMetadataType extends MongoDBChangeStreamMessageMetadata =
    MongoDBChangeStreamMessageMetadata,
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
> = MongoDBSubscriptionOptions<MessageType> & WritableOptions;

class SubscriptionSequentialHandler<
  MessageType extends Message = AnyMessage,
> extends Transform {
  private options: SubscriptionSequentialHandlerOptions<MessageType>;
  public isRunning: boolean;

  constructor(options: SubscriptionSequentialHandlerOptions<MessageType>) {
    super({ objectMode: true, ...options });
    this.options = options;
    // this.from = options.from;
    this.isRunning = true;
  }

  async _transform(
    change: OplogChange<MessageType, RecordedMessageMetadata>,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      if (!this.isRunning || !change) {
        callback();
        return;
      }

      const changeStreamCheckpoint = change._id;
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

      let lastCheckpoint: MongoDBCheckpoint | undefined = undefined;
      const messages = streamChange.messages.map((message, index) => {
        lastCheckpoint = toMongoDBCheckpoint(changeStreamCheckpoint, index);
        return {
          kind: message.kind,
          type: message.type,
          data: message.data,
          metadata: {
            ...message.metadata,
            checkpoint: lastCheckpoint,
            globalPosition: lastCheckpoint,
          },
        } as unknown as RecordedMessage<
          MessageType,
          MongoDBChangeStreamMessageMetadata
        >;
      });

      const result = await this.options.eachBatch(messages);

      if (result && result.type === 'STOP') {
        this.isRunning = false;
        if (!result.error) this.push(lastCheckpoint);
        this.push(result);
        this.push(null);
        callback();
        return;
      }

      this.push(lastCheckpoint);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

const REGEXP =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const databaseUnavailableErrorMessages = [
  'getaddrinfo ENOTFOUND not-existing',
  'getaddrinfo EAI_AGAIN not-existing',
  'Topology is closed',
];

export const isDatabaseUnavailableError = (error: unknown) => {
  return (
    error instanceof Error &&
    databaseUnavailableErrorMessages.indexOf(error.message) !== -1
  );
};

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

export const getDatabaseVersionPolicies = async (db: Db) => {
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
        return throwNotSupportedError();
      }
    };

  return {
    supportedVersionCheckPolicy,
    changeStreamFullDocumentValuePolicy,
  };
};

// const DEFAULT_PARTITION_KEY_NAME = 'default';
const createChangeStream = <EventType extends Message = AnyMessage>(
  getFullDocumentValue: ChangeStreamFullDocumentValuePolicy,
  db: Db,
  resumeToken?: CurrentMessageProcessorPosition<MongoDBCheckpoint>,
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
    useBigInt64: true,
    fullDocument: getFullDocumentValue(),
    ...(resumeToken === undefined || resumeToken === 'BEGINNING'
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
        : { resumeAfter: toMongoDBResumeToken(resumeToken.lastCheckpoint) }),
  });
};

const subscribe =
  (getFullDocumentValue: ChangeStreamFullDocumentValuePolicy, db: Db) =>
  <EventType extends Message = AnyMessage>(
    resumeToken?: MongoDBSubscriptionStartFrom,
  ) =>
    createChangeStream<EventType>(getFullDocumentValue, db, resumeToken);

export const mongoDBSubscription = <MessageType extends Message = AnyMessage>({
  client,
  from,
  // batchSize,
  eachBatch,
  resilience,
}: MongoDBSubscriptionOptions<MessageType>): MongoDBSubscription => {
  let isRunning = false;

  let start: Promise<void>;
  let processor: SubscriptionSequentialHandler<MessageType>;

  let subscription: StreamSubscription<MessageType> | undefined;

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

    if (!subscription) return Promise.resolve();

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

  const pipeMessages = (options: MongoDBSubscriptionStartOptions) => {
    let retry = 0;

    return asyncRetry(async () => {
      const db = client.db(options.dbName);

      const versionPolicies = await getDatabaseVersionPolicies(db);
      const policy = versionPolicies.changeStreamFullDocumentValuePolicy;

      return new Promise<void>((resolve, reject) => {
        if (!isRunning) {
          resolve();
          return;
        }

        console.info(
          `Starting subscription. ${retry++} retries. From: ${JSONParser.stringify(from)}, Start from: ${JSONParser.stringify(
            options.startFrom,
          )}`,
        );

        subscription = subscribe(
          policy,
          client.db(options.dbName),
        )<MessageType>(options.startFrom);

        processor = new SubscriptionSequentialHandler<MessageType>({
          client,
          from,
          // batchSize,
          eachBatch,
          resilience,
        });

        const handler = new (class extends Writable {
          async _write(
            result: MongoDBCheckpoint | MessageHandlerResult,
            _encoding: string,
            done: () => void,
          ) {
            if (!isRunning) return;

            if (isMongoDBCheckpoint(result)) {
              options.startFrom = {
                lastCheckpoint: result,
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

              console.error(`Received error: ${JSONParser.stringify(error)}.`);
              reject(error);
            });
          },
        );
      });
    }, resubscribeOptions);
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

export * from './mongoDBCheckpoint';
export { subscribe };
