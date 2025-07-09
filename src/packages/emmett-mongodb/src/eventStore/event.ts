import type {
  RecordedMessageMetadata,
  RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { MongoDBResumeToken } from './consumers/subscriptions/types';

export type StringStreamPosition = MongoDBResumeToken;
export type StringGlobalPosition = MongoDBResumeToken;
export type ReadEventMetadataWithGlobalPosition<
  GlobalPosition = StringGlobalPosition,
> = RecordedMessageMetadataWithGlobalPosition<GlobalPosition>;
export type MongoDBRecordedMessageMetadata = RecordedMessageMetadata<
  undefined,
  StringStreamPosition
>;
