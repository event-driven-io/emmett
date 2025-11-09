import {
  IllegalStateError,
  type CurrentMessageProcessorPosition,
} from '@event-driven-io/emmett';

export type MongoDBResumeToken = Readonly<{ _data: string }>;

export type MongoDBCheckpoint =
  `emt:chkpt:mongodb:${MongoDBResumeToken['_data']}:${bigint}`;

export const isMongoDBCheckpoint = (
  value: unknown,
): value is MongoDBCheckpoint =>
  typeof value === 'string' && value.startsWith('emt:chkpt:mongodb:');

export const toMongoDBCheckpoint = (
  resumeToken: MongoDBResumeToken,
  position: bigint | number | undefined,
): MongoDBCheckpoint => {
  return `emt:chkpt:mongodb:${resumeToken._data}:${position ?? 0}` as MongoDBCheckpoint;
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

export const isMongoDBResumeToken = (
  value: unknown,
): value is MongoDBResumeToken => {
  return !!(
    typeof value === 'object' &&
    value &&
    '_data' in value &&
    typeof value._data === 'string'
  );
};

/**
 * Compares two MongoDB Resume Tokens.
 * @param token1 Token 1.
 * @param token2 Token 2.
 * @returns 0 - if the tokens are the same, 1 - if the token1 is later, -1 - is the token1 is earlier.
 */
export const compareTwoMongoDBTokens = (
  token1: MongoDBResumeToken,
  token2: MongoDBResumeToken,
) => compareTwoHexBuffers(token1._data, token2._data);

/**
 * Compares two MongoDB Resume Tokens.
 * @param token1 Token 1.
 * @param token2 Token 2.
 * @returns 0 - if the tokens are the same, 1 - if the token1 is later, -1 - is the token1 is earlier.
 */
export const compareTwoHexBuffers = (
  token1: MongoDBResumeToken['_data'],
  token2: MongoDBResumeToken['_data'],
) => {
  const bufA = Buffer.from(token1, 'hex');
  const bufB = Buffer.from(token2, 'hex');

  return Buffer.compare(bufA, bufB);
};

export const compareTwoMongoDBCheckpoints = (
  checkpoint1: MongoDBCheckpoint,
  checkpoint2: MongoDBCheckpoint,
) => {
  const { resumeToken: rt1, position: pos1 } =
    toMongoDBCheckpointValues(checkpoint1);
  const { resumeToken: rt2, position: pos2 } =
    toMongoDBCheckpointValues(checkpoint2);
  const tokenComparison = compareTwoHexBuffers(rt1, rt2);

  if (tokenComparison !== 0) {
    return tokenComparison;
  }

  return pos1 < pos2 ? -1 : pos1 > pos2 ? 1 : 0;
};

export const compareTwoTokens = (token1: unknown, token2: unknown) => {
  if (token1 === null && token2) {
    return -1;
  }

  if (token1 && token2 === null) {
    return 1;
  }

  if (token1 === null && token2 === null) {
    return 0;
  }

  if (isMongoDBCheckpoint(token1) && isMongoDBCheckpoint(token2)) {
    return compareTwoMongoDBCheckpoints(token1, token2);
  }

  if (typeof token1 === 'string' && typeof token2 === 'string') {
    return compareTwoHexBuffers(token1, token2);
  }

  throw new IllegalStateError(`Type of tokens is not comparable`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zipMongoDBMessageBatchPullerStartFrom = <CheckpointType = any>(
  options: (CurrentMessageProcessorPosition<CheckpointType> | undefined)[],
): CurrentMessageProcessorPosition<CheckpointType> => {
  if (
    options.length === 0 ||
    options.some((o) => o === undefined || o === 'BEGINNING')
  ) {
    return 'BEGINNING';
  }

  if (options.every((o) => o === 'END')) {
    return 'END';
  }

  const positionTokens = options.filter(
    (o) => o !== undefined && o !== 'BEGINNING' && o !== 'END',
  );

  const sorted = positionTokens.sort((a, b) => {
    return compareTwoTokens(a.lastCheckpoint, b.lastCheckpoint);
  });

  return sorted[0]!;
};
