import type {
  AnyMessage,
  AnyRecordedMessageMetadata,
  RecordedMessage,
} from '../../typing';

export type MessageDowncast<
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> =
  | ((
      message: RecordedMessage<MessageType, RecordedMessageMetadataType>,
    ) => RecordedMessage<MessagePayloadType, RecordedMessageMetadataType>)
  | ((message: MessageType) => MessagePayloadType);

export const downcastRecordedMessage = <
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
>(
  recordedMessage:
    | RecordedMessage<MessageType, RecordedMessageMetadataType>
    | MessageType,
  options?: {
    downcast?: MessageDowncast<
      MessageType,
      MessagePayloadType,
      RecordedMessageMetadataType
    >;
  },
): RecordedMessage<MessagePayloadType, RecordedMessageMetadataType> => {
  if (!options?.downcast)
    return recordedMessage as unknown as RecordedMessage<
      MessagePayloadType,
      RecordedMessageMetadataType
    >;

  const downcasted = options.downcast(
    recordedMessage as RecordedMessage<
      MessageType,
      RecordedMessageMetadataType
    >,
  );

  return {
    ...recordedMessage,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    data: downcasted.data,
    ...('metadata' in recordedMessage || 'metadata' in downcasted
      ? {
          metadata: {
            ...('metadata' in recordedMessage
              ? (recordedMessage.metadata as object)
              : {}),
            ...('metadata' in downcasted
              ? (downcasted.metadata as object)
              : {}),
          },
        }
      : {}),
  } as unknown as RecordedMessage<
    MessagePayloadType,
    RecordedMessageMetadataType
  >;
};

export const downcastRecordedMessages = <
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  RecordedMessageMetadataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
>(
  recordedMessages:
    | RecordedMessage<MessageType, RecordedMessageMetadataType>[]
    | MessageType[],
  options?: {
    downcast?: MessageDowncast<
      MessageType,
      MessagePayloadType,
      RecordedMessageMetadataType
    >;
  },
): RecordedMessage<MessagePayloadType, RecordedMessageMetadataType>[] => {
  if (!options?.downcast)
    return recordedMessages as unknown as RecordedMessage<
      MessagePayloadType,
      RecordedMessageMetadataType
    >[];

  return recordedMessages.map((recordedMessage) =>
    downcastRecordedMessage(recordedMessage, options),
  );
};
