import type {
  AsyncRetryOptions,
  BatchRecordedMessageHandlerWithoutContext,
  Event,
  Message,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type {
  ChangeStreamDeleteDocument,
  ChangeStreamInsertDocument,
  ChangeStreamReplaceDocument,
  ChangeStreamUpdateDocument,
  Db,
  Document,
  MongoClient,
  ResumeToken,
} from 'mongodb';
import type { EventStream } from '../../mongoDBEventStore';
import type { MongoDBResumeToken } from './types';

export type MongoDBSubscriptionOptions<MessageType extends Message = Message> =
  {
    // from?: EventStoreDBEventStoreConsumerType;
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
  | { lastCheckpoint: MongoDBResumeToken }
  | 'BEGINNING'
  | 'END';

export type MongoDBSubscriptionStartOptions = {
  startFrom: MongoDBSubscriptionStartFrom;
};

// export type EventStoreDBEventStoreConsumerType =
//   | {
//       stream: $all;
//       options?: Exclude<SubscribeToAllOptions, 'fromPosition'>;
//     }
//   | {
//       stream: string;
//       options?: Exclude<SubscribeToStreamOptions, 'fromRevision'>;
//     };
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

const createChangeStream = <EventType extends Event = Event>(
  getFullDocumentValue: ChangeStreamFullDocumentValuePolicy,
  db: Db,
  // messages: Collection<EventStream<EventType>>,
  // partitionKey: string,
  resumeToken?: ResumeToken,
) => {
  //: Partial<MongoDBSubscriptionDocument<EventStream<EventType>>>
  const $match = {
    'ns.coll': { $regex: /^emt:/ },
    $or: [
      { operationType: 'insert' },
      {
        operationType: 'update',
        'updateDescription.updatedFields.messages': { $exists: true },
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
    startAfter: resumeToken,
  });
};

const subscribe =
  (getFullDocumentValue: ChangeStreamFullDocumentValuePolicy, db: Db) =>
  <EventType extends Event = Event>(resumeToken?: ResumeToken) => {
    return createChangeStream<EventType>(getFullDocumentValue, db, resumeToken);
  };

const zipMongoDBMessageBatchPullerStartFrom = (
  options: (MongoDBSubscriptionStartFrom | undefined)[],
): MongoDBSubscriptionStartFrom => {
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
    const bufA = Buffer.from(a.lastCheckpoint._data, 'hex'); // or 'base64', depending on encoding
    const bufB = Buffer.from(b.lastCheckpoint._data, 'hex');
    return Buffer.compare(bufA, bufB);
  });

  return sorted[0]!;
};

export {
  subscribe,
  zipMongoDBMessageBatchPullerStartFrom as zipMongoDBEventStoreMessageBatchPullerStartFrom,
};
