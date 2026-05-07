import type {
  AnyMessage,
  AnyReadEventMetadata,
  Brand,
  DefaultRecord,
  Message,
  RecordedMessage,
} from '../typing';
import { bigInt } from '../utils';

/////////////////////////////////////
//// Checkpoints
//////////////////////////////////////

export type ProcessorCheckpoint = Brand<string, 'ProcessorCheckpoint'>;
export const ProcessorCheckpoint = (checkpoint: string): ProcessorCheckpoint =>
  checkpoint as ProcessorCheckpoint;

export const bigIntProcessorCheckpoint = (value: bigint): ProcessorCheckpoint =>
  bigInt.toNormalizedString(value) as ProcessorCheckpoint;

export const parseBigIntProcessorCheckpoint = (
  value: ProcessorCheckpoint,
): bigint => BigInt(value);

export type GetCheckpoint<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetadataType>,
) => ProcessorCheckpoint | null;

export const getCheckpoint = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
): ProcessorCheckpoint | null => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
  return message.metadata.checkpoint;
};

/////////////////////////////////////
//// Checkpointer
//////////////////////////////////////

export type Checkpointer<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  read: ReadProcessorCheckpoint<HandlerContext>;
  store: StoreProcessorCheckpoint<
    MessageType,
    MessageMetadataType,
    HandlerContext
  >;
};

export type ReadProcessorCheckpoint<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (
  options: { processorId: string; partition?: string },
  context: HandlerContext,
) => Promise<ReadProcessorCheckpointResult>;

export type StoreProcessorCheckpoint<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  options: {
    message: RecordedMessage<MessageType, MessageMetadataType>;
    processorId: string;
    version: number | undefined;
    lastCheckpoint: ProcessorCheckpoint | null;
    partition?: string;
  },
  context: HandlerContext,
) => Promise<StoreProcessorCheckpointResult>;

export type StoreProcessorCheckpointResult =
  | {
      success: true;
      newCheckpoint: ProcessorCheckpoint | null;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' | 'CURRENT_AHEAD' };

export type ReadProcessorCheckpointResult = {
  lastCheckpoint: ProcessorCheckpoint | null;
};
