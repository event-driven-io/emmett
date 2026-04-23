export const scopeAttributes = (prefix = 'almanac') =>
  ({
    type: `${prefix}.scope.type`,
    main: `${prefix}.scope.main`,
  }) as const;

export const MessagingAttributes = {
  system: 'messaging.system',
  messageId: 'messaging.message.id',
  messageConversationId: 'messaging.message.conversation_id',
  messageCausationId: 'messaging.message.causation_id',
  batchMessageCount: 'messaging.batch.message_count',
  operationType: 'messaging.operation.type',
  destinationName: 'messaging.destination.name',
  messageBodySize: 'messaging.message.body.size',
  traceId: 'trace.id',
  spanId: 'span.id',
} as const;

export type AttributeTarget = 'mainSpan' | 'currentSpan' | 'both';
