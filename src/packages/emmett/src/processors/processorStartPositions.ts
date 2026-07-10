import type {
  AnyMessage,
  AnyReadEventMetadata,
  RecordedMessage,
} from '../typing';
import { getCheckpoint, type ProcessorCheckpoint } from './checkpoints';
import { CurrentMessageProcessorPosition } from './processors';

export type ProcessorStartPositionsOptions = {
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
};

export type ProcessorStartPositions = {
  set: (
    processorId: string,
    position: CurrentMessageProcessorPosition | undefined,
  ) => void;
  zip: () => CurrentMessageProcessorPosition;
  afterStartPosition: <
    MessageType extends AnyMessage = AnyMessage,
    MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  >(
    processorId: string,
    messages: RecordedMessage<MessageType, MessageMetadataType>[],
  ) => RecordedMessage<MessageType, MessageMetadataType>[];
};

export const processorStartPositions = (
  options?: ProcessorStartPositionsOptions,
): ProcessorStartPositions => {
  const positions = new Map<
    string,
    CurrentMessageProcessorPosition | undefined
  >();

  return {
    set: (processorId, position) => {
      positions.set(processorId, position);
    },
    zip: () =>
      CurrentMessageProcessorPosition.zip(
        [...positions.values()],
        options?.compareCheckpoints,
      ),
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
        return checkpoint !== null && checkpoint > lastCheckpoint;
      });
    },
  };
};
