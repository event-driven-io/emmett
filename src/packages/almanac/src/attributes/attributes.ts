export const scopeAttributes = (prefix = 'almanac') =>
  ({
    type: `${prefix}.scope.type`,
    main: `${prefix}.scope.main`,
  }) as const;

export const MessagingAttributes = {
  system: 'messaging.system',
  message: {
    id: 'messaging.message.id',
    correlationId: 'messaging.message.correlation_id',
    causationId: 'messaging.message.causation_id',
    conversationId: 'messaging.message.conversation_id',
    bodySize: 'messaging.message.body.size',
  },
  batch: {
    messageCount: 'messaging.batch.message_count',
  },
  operation: {
    type: 'messaging.operation.type',
  },
  destination: {
    name: 'messaging.destination.name',
  },
} as const;

export type AttributeTarget = 'mainSpan' | 'currentSpan' | 'both';
