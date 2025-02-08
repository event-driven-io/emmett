import type {
  BigIntGlobalPosition,
  BigIntStreamPosition,
  Command,
  DefaultRecord,
  Event,
} from '.';

export type Message<
  Type extends string = string,
  Data extends DefaultRecord = DefaultRecord,
  MetaData extends DefaultRecord | undefined = undefined,
> = Command<Type, Data, MetaData> | Event<Type, Data, MetaData>;

export type MessageKindOf<T extends Message> = T['kind'];
export type MessageTypeOf<T extends Message> = T['type'];
export type MessageDataOf<T extends Message> = T['data'];
export type MessageMetaDataOf<T extends Message> = T extends {
  metadata: infer M;
}
  ? M
  : undefined;

export type CanHandle<T extends Message> = MessageTypeOf<T>[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const message = <MessageType extends Message<string, any, any>>(
  ...args: MessageMetaDataOf<MessageType> extends undefined
    ? [
        kind: MessageKindOf<MessageType>,
        type: MessageTypeOf<MessageType>,
        data: MessageDataOf<MessageType>,
      ]
    : [
        kind: MessageKindOf<MessageType>,
        type: MessageTypeOf<MessageType>,
        data: MessageDataOf<MessageType>,
        metadata: MessageMetaDataOf<MessageType>,
      ]
): MessageType => {
  const [kind, type, data, metadata] = args;

  return metadata !== undefined
    ? ({ type, data, metadata, kind } as MessageType)
    : ({ type, data, kind } as MessageType);
};

export type CombinedRecordedMessageMetadata<
  MessageType extends Message = Message,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> =
  MessageMetaDataOf<MessageType> extends undefined
    ? MessageMetaDataType
    : MessageMetaDataOf<MessageType> & MessageMetaDataType;

export type RecordedMessage<
  MessageType extends Message = Message,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = MessageType & {
  kind: NonNullable<MessageKindOf<Message>>;
  metadata: CombinedRecordedMessageMetadata<MessageType, MessageMetaDataType>;
};

export type CommonRecordedMessageMetadata<
  StreamPosition = BigIntStreamPosition,
> = Readonly<{
  messageId: string;
  streamPosition: StreamPosition;
  streamName: string;
}>;

export type WithGlobalPosition<GlobalPosition> = Readonly<{
  globalPosition: GlobalPosition;
}>;

export type RecordedMessageMetadata<
  GlobalPosition = undefined,
  StreamPosition = BigIntStreamPosition,
> = CommonRecordedMessageMetadata<StreamPosition> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  (GlobalPosition extends undefined ? {} : WithGlobalPosition<GlobalPosition>);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecordedMessageMetadata = RecordedMessageMetadata<any, any>;

export type RecordedMessageMetadataWithGlobalPosition<
  GlobalPosition = BigIntGlobalPosition,
> = RecordedMessageMetadata<GlobalPosition>;

export type RecordedMessageMetadataWithoutGlobalPosition<
  StreamPosition = BigIntStreamPosition,
> = RecordedMessageMetadata<undefined, StreamPosition>;

export type GlobalPositionTypeOfRecordedMessageMetadata<
  RecordedMessageMetadataType,
> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RecordedMessageMetadataType extends RecordedMessageMetadata<infer GP, any>
    ? GP
    : never;

export type StreamPositionTypeOfRecordedMessageMetadata<
  RecordedMessageMetadataType,
> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RecordedMessageMetadataType extends RecordedMessageMetadata<any, infer SV>
    ? SV
    : never;
