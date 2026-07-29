import {
  IllegalStateError,
  ProcessorCheckpoint,
  bigIntProcessorCheckpoint,
} from '@event-driven-io/emmett';

export type MongoDBResumeToken = Readonly<{ _data: string }>;

/**
 * Both parts are fixed width, so checkpoints sort with the default comparator:
 * the resume token is hex of a stable length and the message position is zero
 * padded.
 */
export type MongoDBCheckpoint =
  `emt:chkpt:mongodb:${MongoDBResumeToken['_data']}:${string}` &
    ProcessorCheckpoint;

export const isMongoDBCheckpoint = (
  value: unknown,
): value is MongoDBCheckpoint =>
  typeof value === 'string' && value.startsWith('emt:chkpt:mongodb:');

export const toMongoDBCheckpoint = (
  resumeToken: MongoDBResumeToken,
  position: bigint | number | undefined,
): MongoDBCheckpoint => {
  return `emt:chkpt:mongodb:${resumeToken._data}:${bigIntProcessorCheckpoint(BigInt(position ?? 0))}` as MongoDBCheckpoint;
};

export const toMongoDBCheckpointValues = (
  checkpoint: MongoDBCheckpoint,
): { resumeToken: MongoDBResumeToken['_data']; position: bigint } => {
  const parts = checkpoint.split(':');
  if (
    parts.length !== 5 ||
    parts[0] !== 'emt' ||
    parts[1] !== 'chkpt' ||
    parts[2] !== 'mongodb'
  ) {
    throw new IllegalStateError(
      `Invalid MongoDB checkpoint format: ${checkpoint}`,
    );
  }

  return { resumeToken: parts[3]!, position: BigInt(parts[4]!) };
};

export const toMongoDBResumeToken = (
  checkpoint: MongoDBCheckpoint,
): MongoDBResumeToken => {
  const { resumeToken } = toMongoDBCheckpointValues(checkpoint);
  return { _data: resumeToken };
};

/**
 * Compares two checkpoints, either of which may be missing.
 * @returns 0 - if they are the same, 1 - if the checkpoint1 is later, -1 - if the checkpoint1 is earlier.
 */
export const compareTwoCheckpoints = (
  checkpoint1: unknown,
  checkpoint2: unknown,
) => {
  if (checkpoint1 === null && checkpoint2) {
    return -1;
  }

  if (checkpoint1 && checkpoint2 === null) {
    return 1;
  }

  if (checkpoint1 === null && checkpoint2 === null) {
    return 0;
  }

  if (typeof checkpoint1 === 'string' && typeof checkpoint2 === 'string') {
    return ProcessorCheckpoint.compare(
      checkpoint1 as ProcessorCheckpoint,
      checkpoint2 as ProcessorCheckpoint,
    );
  }

  throw new IllegalStateError(`Type of checkpoints is not comparable`);
};
