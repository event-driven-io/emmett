import type { DefaultRecord } from '.';
import type { EmmettError } from '../errors';
import type {
  ObservabilityScope,
  WithObservabilityScope,
} from '../observability';
import type {
  AnyMessage,
  AnyRecordedMessage,
  AnyRecordedMessageMetadata,
  Message,
  RecordedMessage,
} from './message';

/**
 * What a context carries on its own. The session and the observability scope
 * are added by `MessageHandlerContext`, so a root may not declare either.
 */
export type HandlerContextRoot = DefaultRecord & {
  session?: never;
  observabilityScope?: never;
};

/**
 * What your handler gets for the message it is handling. Whatever it was
 * handed to talk to the outside lives under `context.session`: a SQL store
 * puts the connection, the transaction you are inside, the pool and the driver
 * options there, a document store puts its client there. A processor that
 * names no session gets one it knows nothing about.
 */
export type MessageHandlerContext<
  HandlerContext extends HandlerContextRoot = Record<never, never>,
  Session extends DefaultRecord = DefaultRecord,
> = WithObservabilityScope<HandlerContext & { session: Session }>;

export type AnyMessageHandlerContext = {
  session: DefaultRecord;
  observabilityScope: ObservabilityScope;
};

export type PartialHandlerContext<Ctx extends AnyMessageHandlerContext> =
  Partial<Omit<Ctx, 'session' | 'observabilityScope'>> & {
    session?: Partial<Ctx['session']>;
    observabilityScope?: ObservabilityScope;
  };

export type SingleRawMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
> = (
  message: MessageType,
) => Promise<SingleMessageHandlerResult> | SingleMessageHandlerResult;

export type SingleRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
) => Promise<SingleMessageHandlerResult> | SingleMessageHandlerResult;

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
) => Promise<SingleMessageHandlerResult> | SingleMessageHandlerResult;

export type SingleRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  message: RecordedMessage<MessageType, MessageMetaDataType>,
  context: HandlerContext,
) => Promise<SingleMessageHandlerResult> | SingleMessageHandlerResult;

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
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
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
) => Promise<BatchMessageHandlerResult> | BatchMessageHandlerResult;

export type BatchRecordedMessageHandlerWithoutContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> = (
  messages: RecordedMessage<MessageType, MessageMetaDataType>[],
) => Promise<BatchMessageHandlerResult> | BatchMessageHandlerResult;

export type BatchMessageHandlerWithoutContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
> =
  | BatchRawMessageHandlerWithoutContext<MessageType>
  | BatchRecordedMessageHandlerWithoutContext<MessageType, MessageMetaDataType>;

export type BatchRawMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  messages: MessageType[],
  context: HandlerContext,
) => Promise<BatchMessageHandlerResult> | BatchMessageHandlerResult;

export type BatchRecordedMessageHandlerWithContext<
  MessageType extends Message = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (
  messages: RecordedMessage<MessageType, MessageMetaDataType>[],
  context: HandlerContext,
) => Promise<BatchMessageHandlerResult> | BatchMessageHandlerResult;

export type BatchMessageHandlerWithContext<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
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
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
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
  MessageMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> =
  | (HandlerContext extends DefaultRecord
      ? SingleMessageHandler<MessageType, MessageMetaDataType, HandlerContext>
      : SingleMessageHandler<MessageType, MessageMetaDataType>)
  | (HandlerContext extends DefaultRecord
      ? BatchMessageHandler<MessageType, MessageMetaDataType, HandlerContext>
      : BatchMessageHandler<MessageType, MessageMetaDataType>);

export type SingleMessageHandlerResult =
  | void
  | { type: 'ACK' }
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type BatchMessageHandlerResult =
  | void
  | { type: 'ACK' }
  | {
      type: 'SKIP';
      reason?: string;
      lastSuccessfulMessage: AnyRecordedMessage;
    }
  | {
      type: 'STOP';
      reason?: string;
      error?: EmmettError;
      lastSuccessfulMessage?: AnyRecordedMessage;
    };
