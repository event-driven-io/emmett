import {
  IllegalStateError,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type CurrentMessageProcessorPosition,
  type Event,
  type Message,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  Timestamp,
  type ChangeStreamDeleteDocument,
  type ChangeStreamInsertDocument,
  type ChangeStreamReplaceDocument,
  type ChangeStreamUpdateDocument,
  type Db,
  type Document,
  type MongoClient,
} from 'mongodb';
import type { EventStream } from '../../mongoDBEventStore';
import { isMongoDBResumeToken, type MongoDBResumeToken } from './types';

export type MongoDBSubscriptionOptions<MessageType extends Message = Message> =
  {
    // from?: MongoDBEventStoreConsumerType;
    client: MongoClient;
    batchSize: number;
    eachBatch: BatchRecordedMessageHandlerWithoutContext<
      MessageType,
      ReadEventMetadataWithGlobalPosition
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
  | ChangeStreamReplaceDocument<TSchema>
  | ChangeStreamDeleteDocument<TSchema>;
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
  CurrentMessageProcessorPosition<MongoDBResumeToken>;

export type MongoDBSubscriptionStartOptions = {
  startFrom: MongoDBSubscriptionStartFrom;
};

const REGEXP =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

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
    throw new Error();
    // throw new NotSupportedMongoVersionError({
    //   currentVersion: buildInfo.version,
    //   supportedVersions: SupportedMajorMongoVersions,
    // });
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
        throw new Error(`Major number is ${major}`);
        // throwNotSupportedError();
      }
    };

  return {
    supportedVersionCheckPolicy,
    changeStreamFullDocumentValuePolicy,
  };
};

const DEFAULT_PARTITION_KEY_NAME = 'default';
const createChangeStream = <
  EventType extends Event = Event,
  CheckpointType = any,
>(
  getFullDocumentValue: ChangeStreamFullDocumentValuePolicy,
  db: Db,
  resumeToken?: CurrentMessageProcessorPosition<CheckpointType>,
  partitionKey: string = DEFAULT_PARTITION_KEY_NAME,
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
    EventStream<EventType>,
    MongoDBSubscriptionDocument<EventStream<EventType>>
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
  <EventType extends Event = Event, CheckpointType = any>(
    resumeToken?: CurrentMessageProcessorPosition<CheckpointType>,
  ) => {
    return createChangeStream<EventType>(getFullDocumentValue, db, resumeToken);
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
