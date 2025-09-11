import type {
  BigIntStreamPosition,
  RecordedMessageMetadata,
  RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { MongoDBResumeToken } from './consumers/subscriptions/types';

export type ReadEventMetadataWithGlobalPosition<
  GlobalPosition = MongoDBResumeToken,
> = RecordedMessageMetadataWithGlobalPosition<GlobalPosition>;
export type MongoDBRecordedMessageMetadata = RecordedMessageMetadata<
  MongoDBResumeToken,
  BigIntStreamPosition
>;
