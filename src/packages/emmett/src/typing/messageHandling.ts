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

type SingleRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleMessageHandlerWithoutContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
> = [MessageMetaDataType] extends [never]
  ? SingleRawMessageHandlerWithoutContext<MessageType>
  : SingleRecordedMessageHandlerWithoutContext<
      MessageType,
      MessageMetaDataType
    >;

export type SingleRawMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  HandlerContext = DefaultRecord,
> = (
  message: MessageType,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

type SingleRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext = DefaultRecord,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type SingleMessageHandlerWithContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
  HandlerContext = DefaultRecord,
> = [MessageMetaDataType] extends [never]
  ? SingleRawMessageHandlerWithContext<MessageType, HandlerContext>
  : SingleRecordedMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type SingleMessageHandler<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
  HandlerContext = never,
> = [HandlerContext] extends [never]
  ? SingleMessageHandlerWithoutContext<MessageType, MessageMetaDataType>
  : SingleMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type BatchRawMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
> = (
  message: MessageType,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

type BatchRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type BatchMessageHandlerWithoutContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
> = [MessageMetaDataType] extends [never]
  ? BatchRawMessageHandlerWithoutContext<MessageType>
  : BatchRecordedMessageHandlerWithoutContext<MessageType, MessageMetaDataType>;

export type BatchRawMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  HandlerContext = DefaultRecord,
> = (
  message: MessageType,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

type BatchRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext = DefaultRecord,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
  context: HandlerContext,
) => Promise<MessageHandlerResult> | MessageHandlerResult;

export type BatchMessageHandlerWithContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
  HandlerContext = DefaultRecord,
> = [MessageMetaDataType] extends [never]
  ? BatchRawMessageHandlerWithContext<MessageType, HandlerContext>
  : BatchRecordedMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type BatchMessageHandler<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata = never,
  HandlerContext = never,
> = [HandlerContext] extends [never]
  ? BatchMessageHandlerWithoutContext<MessageType, MessageMetaDataType>
  : BatchMessageHandlerWithContext<
      MessageType,
      MessageMetaDataType,
      HandlerContext
    >;

export type MessageHandler<
  MessageType extends Message = Message,
  MessageMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext = never,
> =
  | SingleMessageHandler<MessageType, MessageMetaDataType, HandlerContext>
  | BatchMessageHandler<MessageType, MessageMetaDataType, HandlerContext>;

export type MessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };
