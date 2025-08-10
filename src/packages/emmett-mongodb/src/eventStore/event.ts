import type {
  RecordedMessageMetadata,
  RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { MongoDBResumeToken } from './consumers/subscriptions/types';

export type ReadEventMetadataWithGlobalPosition<
  GlobalPosition extends MongoDBResumeToken = MongoDBResumeToken,
> = RecordedMessageMetadataWithGlobalPosition<GlobalPosition>;
export type MongoDBRecordedMessageMetadata = RecordedMessageMetadata<
  MongoDBResumeToken,
  undefined
>;
