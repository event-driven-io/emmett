import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Message } from '@event-driven-io/emmett';
import { validateWithSchema } from '../contract';

/**
 * Serializes values to JSON, encoding `bigint` as decimal strings and dates as ISO 8601 strings.
 */
export const toJSONText = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );

export type AppendRequestParseResult =
  | { ok: true; messages: Message[] }
  | { ok: false; issues: readonly StandardSchemaV1.Issue[] };

/**
 * Validates the append request body with the configured schema.
 * Messages are passed to the event store as sent.
 */
export const parseAppendRequest = async (
  schema: StandardSchemaV1,
  body: unknown,
): Promise<AppendRequestParseResult> => {
  const result = await validateWithSchema(schema, body);

  return result.issues
    ? { ok: false, issues: result.issues }
    : { ok: true, messages: (body as { messages: Message[] }).messages };
};
