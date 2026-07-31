import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import type { MaybePromise } from '../utils';
import { getCheckpoint, ProcessorCheckpoint } from './checkpoints';
import {
  CurrentMessageProcessorPosition,
  type MessageProcessor,
} from './processors';

export type ConsumerStartPositions = {
  earliestPosition: CurrentMessageProcessorPosition;
  afterStartPosition: <
    MessageType extends AnyMessage = AnyMessage,
    MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  >(
    processorId: string,
    messages: RecordedMessage<MessageType, MessageMetadataType>[],
  ) => RecordedMessage<MessageType, MessageMetadataType>[];
};

export type ProcessorStartPositions = {
  set: (
    processorId: string,
    position: CurrentMessageProcessorPosition | undefined,
  ) => void;
  zip: () => CurrentMessageProcessorPosition;
  with: (expected: 'START' | 'END') => string[];
  afterStartPosition: <
    MessageType extends AnyMessage = AnyMessage,
    MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  >(
    processorId: string,
    messages: RecordedMessage<MessageType, MessageMetadataType>[],
  ) => RecordedMessage<MessageType, MessageMetadataType>[];
};

export const ProcessorStartPositions = (): ProcessorStartPositions => {
  const positions = new Map<
    string,
    CurrentMessageProcessorPosition | undefined
  >();

  return {
    set: (processorId, position) => {
      positions.set(processorId, position);
    },
    with: (expected: 'START' | 'END'): string[] =>
      [...positions.entries()]
        .filter(([, position]) => position === expected)
        .map((p) => p[0]),
    zip: () => CurrentMessageProcessorPosition.zip([...positions.values()]),
    afterStartPosition: (processorId, messages) => {
      const position = positions.get(processorId);

      if (
        position === undefined ||
        position === 'BEGINNING' ||
        position === 'END'
      )
        return messages;

      const { lastCheckpoint } = position;

      return messages.filter((message) => {
        const checkpoint = getCheckpoint(message);
        return (
          checkpoint !== null &&
          ProcessorCheckpoint.compare(checkpoint, lastCheckpoint) > 0
        );
      });
    },
  };
};

export type ResolveConsumerStartPositionsOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors: Array<MessageProcessor<ConsumerMessageType, any, HandlerContext>>;
  readLastMessageCheckpoint: (
    context: Partial<HandlerContext>,
  ) => MaybePromise<ProcessorCheckpoint | null>;
  handlerContext: Partial<HandlerContext>;
  /**
   * Wraps only the processors' own start calls. The checkpoint read stays
   * outside it,
   * because a scope can hold an exclusive store resource (SQLite's is a single
   * pooled connection) that reading the checkpoint would wait on forever.
   */
  scope?: <Result>(
    handler: (context: Partial<HandlerContext>) => Promise<Result>,
  ) => Promise<Result>;
};

export const ConsumerStartPositions = {
  resolve: async <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ConsumerMessageType extends Message = any,
    HandlerContext extends MessageHandlerContext | undefined = undefined,
  >({
    processors,
    handlerContext: handlerOptions,
    readLastMessageCheckpoint,
    scope,
  }: ResolveConsumerStartPositionsOptions<
    ConsumerMessageType,
    HandlerContext
  >): Promise<ConsumerStartPositions> => {
    const positions = ProcessorStartPositions();

    const inScope =
      scope ??
      ((handler: (context: Partial<HandlerContext>) => Promise<void>) =>
        handler(handlerOptions));

    await inScope((context) =>
      Promise.all(
        processors.map(async (o) => {
          try {
            const position = await o.start(context);

            positions.set(o.id, position);
          } catch (error) {
            console.log(
              `Error during processor start position retrieval for processor: ${o.id}. Stopping it.`,
              error,
            );
            throw error;
          }
        }),
      ).then(() => undefined),
    );

    const endProcessorIds = positions.with('END');

    if (endProcessorIds.length > 0) {
      const lastCheckpoint = await readLastMessageCheckpoint(handlerOptions);

      for (const processorId of endProcessorIds)
        positions.set(
          processorId,
          lastCheckpoint ? { lastCheckpoint } : 'BEGINNING',
        );
    }

    const earliestPosition = positions.zip();

    return {
      earliestPosition,
      afterStartPosition: (processorId, messages) =>
        positions.afterStartPosition(processorId, messages),
    };
  },
};
