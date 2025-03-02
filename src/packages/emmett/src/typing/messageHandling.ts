import type { DefaultRecord } from '.';
import type { EmmettError } from '../errors';
import type {
  AnyMessage,
  AnyRecordedMessageMetadata,
  Message,
  RecordedMessage,
} from './message';
export type SingleRawMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
> = (
  message: MessageType,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleMessageHandlerWithoutContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
> =
  | SingleRawMessageHandlerWithoutContext<MessageType>
  | SingleRecordedMessageHandlerWithoutContext<
      MessageType,
      MessageMetaDataType
    >;

export type SingleRawMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  message: MessageType,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleMessageHandlerWithContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
  HandlerContext extends DefaultRecord = DefaultRecord,
> =
  | SingleRawMessageHandlerWithContext<MessageType, HandlerContext>
  | SingleRecordedMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type SingleMessageHandler<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = HandlerContext extends DefaultRecord
  ? SingleMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >
  : SingleMessageHandlerWithoutContext<MessageType, MessageMetaDataType>;

export type BatchRawMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
> = (
  messages: MessageType[],
) => Promise<MessageHandlerResult> | MessageHandlerResult;

type BatchRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = (
  messages: RecordedMessage<MessageType, MessageMetaDataType>[],
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type BatchMessageHandlerWithoutContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> =
  | BatchRawMessageHandlerWithoutContext<MessageType>
  | BatchRecordedMessageHandlerWithoutContext<MessageType, MessageMetaDataType>;

export type BatchRawMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  messages: MessageType[],
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type BatchRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (
  messages: RecordedMessage<MessageType, MessageMetaDataType>[],
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type BatchMessageHandlerWithContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> =
  | BatchRawMessageHandlerWithContext<MessageType, HandlerContext>
  | BatchRecordedMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type BatchMessageHandler<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = HandlerContext extends DefaultRecord
  ? BatchMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >
  : BatchMessageHandlerWithoutContext<MessageType, MessageMetaDataType>;

export type MessageHandler<
  MessageType extends Message = Message,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> =
  | (HandlerContext extends DefaultRecord
      ? SingleMessageHandler<MessageType, MessageMetaDataType, HandlerContext>
      : SingleMessageHandler<MessageType, MessageMetaDataType>)
  | (HandlerContext extends DefaultRecord
      ? BatchMessageHandler<MessageType, MessageMetaDataType, HandlerContext>
      : BatchMessageHandler<MessageType, MessageMetaDataType>);

export type MessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };
