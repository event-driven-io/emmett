// Prototype of schema-backed message definitions. Not production code.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { IsSchema, type StaticDecode, type TSchema } from 'typebox';
import Value from 'typebox/value';

type DefaultRecord = Record<string, unknown>;

/////////////////////////////////////////
////////// Today's Emmett types, unchanged
/////////////////////////////////////////

export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
> = Readonly<
  EventMetaData extends undefined
    ? { type: EventType; data: EventData }
    : { type: EventType; data: EventData; metadata: EventMetaData }
> & { readonly kind?: 'Event' };

export type DefaultCommandMetadata = { now: Date };

export type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
> = Readonly<
  CommandMetaData extends undefined
    ? {
        type: CommandType;
        data: Readonly<CommandData>;
        metadata?: DefaultCommandMetadata | undefined;
      }
    : { type: CommandType; data: CommandData; metadata: CommandMetaData }
> & { readonly kind?: 'Command' };

/////////////////////////////////////////
////////// Schemas: TypeBox built in, or any Standard Schema
/////////////////////////////////////////

export type MessageSchema = StandardSchemaV1 | TSchema;

export type InferSchema<Schema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Schema>
  : Schema extends TSchema
    ? StaticDecode<Schema>
    : never;

type InferRecord<Schema> =
  InferSchema<Schema> extends infer R extends DefaultRecord ? R : never;

type InferMetadata<Schema> = Schema extends MessageSchema
  ? InferRecord<Schema>
  : undefined;

export type ValidationResult<T> =
  | { value: T; issues?: undefined }
  | { issues: readonly { message: string; path?: string }[] };

const validateWith = async (
  schema: MessageSchema,
  value: unknown,
): Promise<ValidationResult<unknown>> => {
  if ('~standard' in schema) {
    const result = await schema['~standard'].validate(value);
    return result.issues
      ? { issues: result.issues.map((i) => ({ message: i.message })) }
      : { value: result.value };
  }
  if (!Value.Check(schema, value))
    return {
      issues: Value.Errors(schema, value).map((e) => ({
        message: e.message,
        path: e.instancePath,
      })),
    };
  return { value: Value.Decode(schema, value) };
};

const withoutTypeBoxInternals = (schema: object): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key.startsWith('~') ? undefined : value,
    ),
  ) as Record<string, unknown>;

const toJSONSchemaOf = (schema: MessageSchema): Record<string, unknown> =>
  '~standard' in schema
    ? (
        schema['~standard'] as unknown as {
          jsonSchema: {
            input: (o: { target: string }) => Record<string, unknown>;
          };
        }
      ).jsonSchema.input({ target: 'draft-2020-12' })
    : withoutTypeBoxInternals(schema);

/////////////////////////////////////////
////////// Message definitions
/////////////////////////////////////////

type MessageOptions<DataSchema, MetadataSchema> = {
  data: DataSchema;
  metadata?: MetadataSchema;
  description?: string;
};

type MessageDefinitionProps<Kind, MessageType extends string, Message> = {
  readonly kind: Kind;
  readonly type: MessageType;
  readonly description: string | undefined;
  /** Exists only for the type checker: `type X = typeof X.Type` */
  readonly Type: Message;
  validate(value: unknown): Promise<ValidationResult<Message>>;
  toJSONSchema(): Record<string, unknown>;
};

export type EventDefinition<
  EventType extends string,
  EventData extends DefaultRecord,
  EventMetaData extends DefaultRecord | undefined,
> = ((
  ...args: EventMetaData extends undefined
    ? [data: EventData]
    : [data: EventData, metadata: EventMetaData]
) => Event<EventType, EventData, EventMetaData>) &
  MessageDefinitionProps<
    'Event',
    EventType,
    Event<EventType, EventData, EventMetaData>
  >;

export type CommandDefinition<
  CommandType extends string,
  CommandData extends DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined,
> = ((
  ...args: CommandMetaData extends undefined
    ? [data: CommandData, metadata?: DefaultCommandMetadata]
    : [data: CommandData, metadata: CommandMetaData]
) => Command<CommandType, CommandData, CommandMetaData>) &
  MessageDefinitionProps<
    'Command',
    CommandType,
    Command<CommandType, CommandData, CommandMetaData>
  >;

const messageDefinition = <Kind extends 'Event' | 'Command'>(
  kind: Kind,
  type: string,
  options: MessageOptions<MessageSchema, MessageSchema | undefined>,
) => {
  const create = (data: DefaultRecord, metadata?: DefaultRecord) =>
    metadata !== undefined
      ? { type, data, metadata, kind }
      : { type, data, kind };

  const validate = async (
    value: unknown,
  ): Promise<ValidationResult<unknown>> => {
    const message = value as { type?: unknown; data?: unknown; metadata?: unknown };
    if (message?.type !== type)
      return { issues: [{ message: `Expected ${kind} type '${type}'`, path: '/type' }] };

    const data = await validateWith(options.data, message.data);
    if (data.issues) return data;

    if (!options.metadata) return { value: create(data.value as DefaultRecord) };

    const metadata = await validateWith(options.metadata, message.metadata);
    if (metadata.issues) return metadata;

    return {
      value: create(data.value as DefaultRecord, metadata.value as DefaultRecord),
    };
  };

  const toJSONSchema = () => ({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: type,
    ...(options.description ? { description: options.description } : {}),
    type: 'object',
    properties: {
      type: { const: type },
      data: toJSONSchemaOf(options.data),
      ...(options.metadata ? { metadata: toJSONSchemaOf(options.metadata) } : {}),
    },
    required: options.metadata ? ['type', 'data', 'metadata'] : ['type', 'data'],
  });

  return Object.assign(create, {
    kind,
    type,
    description: options.description,
    validate,
    toJSONSchema,
  });
};

export function Event<
  const EventType extends string,
  DataSchema extends MessageSchema,
  MetadataSchema extends MessageSchema | undefined = undefined,
>(
  type: EventType,
  options: MessageOptions<DataSchema, MetadataSchema>,
): EventDefinition<
  EventType,
  InferRecord<DataSchema>,
  InferMetadata<MetadataSchema>
> {
  return messageDefinition('Event', type, options) as unknown as EventDefinition<
    EventType,
    InferRecord<DataSchema>,
    InferMetadata<MetadataSchema>
  >;
}

export function Command<
  const CommandType extends string,
  DataSchema extends MessageSchema,
  MetadataSchema extends MessageSchema | undefined = undefined,
>(
  type: CommandType,
  options: MessageOptions<DataSchema, MetadataSchema>,
): CommandDefinition<
  CommandType,
  InferRecord<DataSchema>,
  InferMetadata<MetadataSchema>
> {
  return messageDefinition('Command', type, options) as unknown as CommandDefinition<
    CommandType,
    InferRecord<DataSchema>,
    InferMetadata<MetadataSchema>
  >;
}

/////////////////////////////////////////
////////// Unions of definitions
/////////////////////////////////////////

type DefinitionLike = {
  readonly kind: 'Event' | 'Command';
  readonly type: string;
  readonly Type: { type: string };
  validate(value: unknown): Promise<ValidationResult<unknown>>;
  toJSONSchema(): Record<string, unknown>;
};

export type MessageUnion<Definitions extends readonly DefinitionLike[]> = {
  readonly definitions: Definitions;
  /** Message types, usable as `canHandle` */
  readonly types: Definitions[number]['type'][];
  /** Exists only for the type checker: `type X = typeof X.Type` */
  readonly Type: Definitions[number]['Type'];
  validate(
    value: unknown,
  ): Promise<ValidationResult<Definitions[number]['Type']>>;
};

const messageUnion = <const Definitions extends readonly DefinitionLike[]>(
  definitions: Definitions,
): MessageUnion<Definitions> =>
  ({
    definitions,
    types: definitions.map((d) => d.type),
    validate: async (value: unknown) => {
      const type = (value as { type?: unknown })?.type;
      const definition = definitions.find((d) => d.type === type);
      return definition
        ? definition.validate(value)
        : { issues: [{ message: `Unknown message type '${String(type)}'`, path: '/type' }] };
    },
  }) as unknown as MessageUnion<Definitions>;

export const Events = <
  const Definitions extends readonly (DefinitionLike & { kind: 'Event' })[],
>(
  ...definitions: Definitions
) => messageUnion(definitions);

export const Commands = <
  const Definitions extends readonly (DefinitionLike & { kind: 'Command' })[],
>(
  ...definitions: Definitions
) => messageUnion(definitions);
