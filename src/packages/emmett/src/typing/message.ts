import type {
  AnyCommand,
  AnyEvent,
  Command,
  DefaultRecord,
  Event,
  GlobalPosition,
  StreamPosition,
} from '.';
import type { ProcessorCheckpoint } from '../processors';
import {
  splitMetadataAndSchemaVersion,
  type WithSchemaVersionArgument,
} from './messageSchemaVersion';

export type Message<
  Type extends string = string,
  Data extends DefaultRecord = DefaultRecord,
  MetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number = string extends Type ? number : 1,
> =
  | Command<Type, Data, MetaData, SchemaVersion>
  | Event<Type, Data, MetaData, SchemaVersion>;

export type AnyMessage = AnyEvent | AnyCommand;

export type MessageKindOf<T extends Message> = T['kind'];
export type MessageSchemaVersionOf<T extends Message> = NonNullable<
  T['schemaVersion']
>;
export type MessageTypeOf<T extends Message> = T['type'];
export type MessageDataOf<T extends Message> = T['data'];
export type MessageMetaDataOf<T extends Message> = T extends {
  metadata: infer M;
}
  ? M
  : undefined;

export type CanHandle<T extends Message> = MessageTypeOf<T>[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const message = <MessageType extends Message<string, any, any, any>>(
  ...args: MessageMetaDataOf<MessageType> extends undefined
    ? WithSchemaVersionArgument<
        MessageType,
        [
          kind: MessageKindOf<MessageType>,
          type: MessageTypeOf<MessageType>,
          data: MessageDataOf<MessageType>,
        ]
      >
    : WithSchemaVersionArgument<
        MessageType,
        [
          kind: MessageKindOf<MessageType>,
          type: MessageTypeOf<MessageType>,
          data: MessageDataOf<MessageType>,
          metadata: MessageMetaDataOf<MessageType>,
        ]
      >
): MessageType => {
  const [kind, type, data, ...optionalArguments] = args;

  return {
    type,
    data,
    kind,
    ...splitMetadataAndSchemaVersion(optionalArguments),
  } as MessageType;
};

export type CombinedMessageMetadata<
  MessageType extends Message = Message,
  MessageMetaDataType extends DefaultRecord = DefaultRecord,
> =
  MessageMetaDataOf<MessageType> extends undefined
    ? MessageMetaDataType
    : MessageMetaDataOf<MessageType> & MessageMetaDataType;

export type CombineMetadata<
  MessageType extends Message = Message,
  MessageMetaDataType extends DefaultRecord = DefaultRecord,
> = MessageType & {
  metadata: CombinedMessageMetadata<MessageType, MessageMetaDataType>;
};

export type RecordedMessage<
  MessageType extends Message = Message,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> = CombineMetadata<MessageType, MessageMetaDataType> & {
  kind: NonNullable<MessageKindOf<Message>>;
};

export const DefaultMessageSchemaVersion = '1';

export type CommonRecordedMessageMetadata = Readonly<{
  messageId: string;
  streamPosition: StreamPosition;
  streamName: string;
  schemaVersion?: string;
  checkpoint?: ProcessorCheckpoint | null;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  spanId?: string;
}>;

export type WithGlobalPosition = Readonly<{
  globalPosition: GlobalPosition;
}>;

export type RecordedMessageMetadata<HasGlobalPosition = undefined> =
  CommonRecordedMessageMetadata &
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    (HasGlobalPosition extends undefined ? {} : WithGlobalPosition);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecordedMessage = Message<any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecordedMessageMetadata = RecordedMessageMetadata<any>;

export type RecordedMessageMetadataWithGlobalPosition =
  RecordedMessageMetadata<true>;

export type RecordedMessageMetadataWithoutGlobalPosition =
  RecordedMessageMetadata<undefined>;
