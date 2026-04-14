export type BatchConfig = {
  totalEvents: number;
  maxStreamLength: number;
  batchSize: number;
};

export function* generateBatches<TEvent>(
  config: BatchConfig,
  generateStream: () => string,
  generateEvent: () => TEvent,
): Generator<{ streamName: string; events: TEvent[] }> {
  const numStreams = Math.ceil(
    config.totalEvents / (config.maxStreamLength / 2),
  );
  const streamNames = Array.from({ length: numStreams }, () =>
    generateStream(),
  );

  let eventsLeft = config.totalEvents;

  while (eventsLeft > 0) {
    const streamName =
      streamNames[Math.floor(Math.random() * streamNames.length)]!;
    const size = Math.min(config.batchSize, eventsLeft);
    const events = Array.from({ length: size }, () => generateEvent());

    yield { streamName, events };
    eventsLeft -= size;
  }
}
