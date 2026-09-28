import type {
  AnyReadEventMetadata,
  Event,
  Message,
  ReadEvent,
} from '@event-driven-io/emmett';
import {
  schemaRef,
  validateAgainstSchema,
  type SchemaValidationError,
} from '../contract';

export type RecordedMessageRepresentation = {
  kind: 'Event' | 'Command';
  type: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

const decimalDigits = /^\d+$/;

/**
 * Positions and checkpoints are decimal strings on the wire.
 * Backends may store them zero-padded for ordering, so the padding is removed.
 */
export const toDecimalString = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && decimalDigits.test(value))
    return BigInt(value).toString();
  return value;
};

/**
 * Maps a recorded message to its transport representation,
 * preserving Emmett's combined metadata shape. Data is passed through
 * without upcasting, downcasting or type revival.
 */
export const toRecordedMessageRepresentation = (
  message: ReadEvent<Event, AnyReadEventMetadata>,
): RecordedMessageRepresentation => {
  const metadata = message.metadata as Record<string, unknown>;

  return {
    kind: message.kind ?? 'Event',
    type: message.type,
    data: message.data,
    metadata: {
      ...metadata,
      streamPosition: toDecimalString(metadata.streamPosition),
      ...(metadata.globalPosition !== undefined &&
      metadata.globalPosition !== null
        ? { globalPosition: toDecimalString(metadata.globalPosition) }
        : {}),
      ...(metadata.checkpoint !== undefined && metadata.checkpoint !== null
        ? { checkpoint: toDecimalString(metadata.checkpoint) }
        : {}),
    },
  };
};

/**
 * Serializes values to JSON, encoding `bigint` as decimal strings and dates as ISO 8601 strings.
 */
export const toJSONText = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );

export type AppendRequestParseResult =
  | { ok: true; messages: Message[] }
  | { ok: false; errors: SchemaValidationError[] };

/**
 * Validates the append request body against the contract schema and maps it to Emmett messages.
 */
export const parseAppendRequest = (body: unknown): AppendRequestParseResult => {
  const errors = validateAgainstSchema(body, schemaRef('AppendRequest'));
  if (errors.length > 0) return { ok: false, errors };

  const { messages } = body as {
    messages: {
      kind?: 'Event' | 'Command';
      type: string;
      data: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }[];
  };

  return {
    ok: true,
    messages: messages.map(
      ({ kind, type, data, metadata }) =>
        ({
          kind: kind ?? 'Event',
          type,
          data,
          ...(metadata !== undefined ? { metadata } : {}),
        }) as Message,
    ),
  };
};
