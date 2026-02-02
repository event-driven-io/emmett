import type {
  AnyMessage,
  AnyRecordedMessageMetadata,
  RecordedMessage,
} from '../../typing';

export type MessageUpcast<
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> =
  | ((message: MessagePayloadType) => MessageType)
  | ((
      message: RecordedMessage<MessagePayloadType, RecordedMessageMetadataType>,
    ) => RecordedMessage<MessageType, RecordedMessageMetadataType>);

export const upcastRecordedMessage = <
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
>(
  recordedMessage: RecordedMessage<
    MessagePayloadType,
    RecordedMessageMetadataType
  >,
  options?: {
    upcast?: MessageUpcast<
      MessageType,
      MessagePayloadType,
      RecordedMessageMetadataType
    >;
  },
): RecordedMessage<MessageType, RecordedMessageMetadataType> => {
  if (!options?.upcast)
    return recordedMessage as unknown as RecordedMessage<
      MessageType,
      RecordedMessageMetadataType
    >;

  const upcasted = options.upcast(recordedMessage);

  return {
    ...recordedMessage,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    data: upcasted.data,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    metadata: {
      ...recordedMessage.metadata,
      ...('metadata' in upcasted ? (upcasted.metadata as object) : {}),
    },
  } as unknown as RecordedMessage<MessageType, RecordedMessageMetadataType>;
};

export const upcastRecordedMessages = <
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
>(
  recordedMessages: RecordedMessage<
    MessagePayloadType,
    RecordedMessageMetadataType
  >[],
  options?: {
    upcast?: MessageUpcast<
      MessageType,
      MessagePayloadType,
      RecordedMessageMetadataType
    >;
  },
): RecordedMessage<MessageType, RecordedMessageMetadataType>[] => {
  if (!options?.upcast)
    return recordedMessages as unknown as RecordedMessage<
      MessageType,
      RecordedMessageMetadataType
    >[];

  return recordedMessages.map((recordedMessage) =>
    upcastRecordedMessage(recordedMessage, options),
  );
};
