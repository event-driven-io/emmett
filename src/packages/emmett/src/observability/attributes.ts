export const EmmettAttributes = {
  command: {
    type: 'emmett.command.type',
    status: 'emmett.command.status',
    eventCount: 'emmett.command.event_count',
    eventTypes: 'emmett.command.event_types',
    origin: 'emmett.command.origin',
    validationError: 'emmett.command.validation_error',
  },
  stream: {
    name: 'emmett.stream.name',
    type: 'emmett.stream.type',
    versionBefore: 'emmett.stream.version.before',
    versionAfter: 'emmett.stream.version.after',
  },
  eventStore: {
    operation: 'emmett.eventstore.operation',
    read: {
      eventCount: 'emmett.eventstore.read.event_count',
      eventTypes: 'emmett.eventstore.read.event_types',
      durationMs: 'emmett.eventstore.read.duration_ms',
      status: 'emmett.eventstore.read.status',
    },
    append: {
      batchSize: 'emmett.eventstore.append.batch_size',
      durationMs: 'emmett.eventstore.append.duration_ms',
      status: 'emmett.eventstore.append.status',
    },
  },
  decide: {
    durationMs: 'emmett.decide.duration_ms',
  },
  event: {
    type: 'emmett.event.type',
  },
  processor: {
    id: 'emmett.processor.id',
    type: 'emmett.processor.type',
    batchSize: 'emmett.processor.batch_size',
    eventTypes: 'emmett.processor.event_types',
    status: 'emmett.processor.status',
    checkpointBefore: 'emmett.processor.checkpoint.before',
    checkpointAfter: 'emmett.processor.checkpoint.after',
    lagEvents: 'emmett.processor.lag_events',
  },
  workflow: {
    id: 'emmett.workflow.id',
    type: 'emmett.workflow.type',
    inputType: 'emmett.workflow.input.type',
    step: 'emmett.workflow.step',
    stateStatus: 'emmett.workflow.state.status',
    stateTransition: 'emmett.workflow.state.transition',
    outputs: 'emmett.workflow.outputs',
    outputsCount: 'emmett.workflow.outputs.count',
    streamPosition: 'emmett.workflow.stream_position',
    decideDurationMs: 'emmett.workflow.decide.duration_ms',
    evolveDurationMs: 'emmett.workflow.evolve.duration_ms',
    stateRebuildEventCount: 'emmett.workflow.state_rebuild.event_count',
  },
  consumer: {
    source: 'emmett.consumer.source',
    batchSize: 'emmett.consumer.batch_size',
    processorCount: 'emmett.consumer.processor_count',
    earliestCheckpoint: 'emmett.consumer.earliest_checkpoint',
    lag: 'emmett.consumer.lag',
    delivery: {
      processorId: 'emmett.consumer.delivery.processor_id',
      status: 'emmett.consumer.delivery.status',
    },
  },
} as const;

export const EmmettMetrics = {
  command: {
    handlingDuration: 'emmett.command.handling.duration',
  },
  event: {
    appendingCount: 'emmett.event.appending.count',
    readingCount: 'emmett.event.reading.count',
  },
  stream: {
    readingDuration: 'emmett.stream.reading.duration',
    readingSize: 'emmett.stream.reading.size',
    appendingDuration: 'emmett.stream.appending.duration',
    appendingSize: 'emmett.stream.appending.size',
  },
  processor: {
    processingDuration: 'emmett.processor.processing.duration',
    lagEvents: 'emmett.processor.lag_events',
  },
  workflow: {
    processingDuration: 'emmett.workflow.processing.duration',
  },
  consumer: {
    pollDuration: 'emmett.consumer.poll.duration',
    deliveryDuration: 'emmett.consumer.delivery.duration',
  },
} as const;

export const ScopeTypes = {
  command: 'command',
  processor: 'processor',
  workflow: 'workflow',
  consumer: 'consumer',
} as const;

export const MessagingSystemName = 'emmett' as const;
