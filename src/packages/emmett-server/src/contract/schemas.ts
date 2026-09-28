import Type from 'typebox';
import { typeBoxSchema, type ContractSchema } from './standardSchema';

/**
 * Reference to a named contract schema, resolved to an OpenAPI component.
 */
export const schemaRef = (name: SchemaName) =>
  Type.Ref(`#/components/schemas/${name}`);

const DecimalString = (description?: string) =>
  Type.String({
    pattern: '^(0|[1-9][0-9]*)$',
    ...(description ? { description } : {}),
  });

const Kind = Type.Union([Type.Literal('Event'), Type.Literal('Command')]);

const JSONObject = Type.Record(Type.String(), Type.Unknown());

/**
 * Default schemas of the Event Store API, defined with TypeBox.
 * Any of them can be replaced with another Standard Schema implementation.
 */
export const DefaultEventStoreApiSchemas = {
  ApiRoot: typeBoxSchema(
    Type.Object({
      apiVersion: Type.String(),
      contractVersion: Type.String(),
      serverVersion: Type.String(),
      capabilities: Type.Object({
        streamReads: Type.Boolean(),
        appends: Type.Boolean(),
        streamExistence: Type.Boolean(),
        streamCatalog: Type.Boolean(),
        finiteStreaming: Type.Boolean(),
        subscriptions: Type.Boolean(),
        subscriptionSources: Type.Array(Type.String()),
        aggregates: Type.Array(Type.String()),
      }),
    }),
  ),
  Stream: typeBoxSchema(
    Type.Object({
      streamName: Type.String(),
      identity: Type.Optional(
        Type.Object({ streamType: Type.String(), streamId: Type.String() }),
      ),
    }),
  ),
  ListedStream: typeBoxSchema(
    Type.Object({
      streamName: Type.String(),
      currentStreamVersion: DecimalString(),
      identity: Type.Optional(
        Type.Object({ streamType: Type.String(), streamId: Type.String() }),
      ),
    }),
  ),
  AppendRequest: typeBoxSchema(
    Type.Object({
      messages: Type.Array(
        Type.Object({
          kind: Type.Optional(Kind),
          type: Type.String({ minLength: 1 }),
          data: JSONObject,
          metadata: Type.Optional(JSONObject),
        }),
        { minItems: 1 },
      ),
    }),
  ),
  AppendResult: typeBoxSchema(
    Type.Object({
      streamName: Type.String(),
      nextExpectedStreamVersion: DecimalString(),
      createdNewStream: Type.Boolean(),
      lastEventGlobalPosition: Type.Optional(
        Type.String({
          description: 'Present only when the backend provides it.',
        }),
      ),
    }),
  ),
  RecordedMessage: typeBoxSchema(
    Type.Object({
      kind: Kind,
      type: Type.String(),
      data: JSONObject,
      metadata: Type.Object(
        {
          messageId: Type.String(),
          streamName: Type.String(),
          streamPosition: DecimalString(),
        },
        {
          additionalProperties: true,
          description:
            "Emmett's combined metadata: user metadata plus recording metadata produced by the event store, e.g. `globalPosition` and `checkpoint` when the backend returns them.",
        },
      ),
    }),
  ),
  HalResource: typeBoxSchema(
    Type.Object({
      _links: Type.Record(Type.String(), Type.Unknown()),
      _embedded: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      _templates: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
  ),
  ProblemDetails: typeBoxSchema(
    Type.Object(
      {
        type: Type.String(),
        title: Type.String(),
        status: Type.Integer(),
        detail: Type.Optional(Type.String()),
        instance: Type.Optional(Type.String()),
        code: Type.Optional(Type.String()),
        traceId: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
  ),
} satisfies Record<string, ContractSchema>;

export type SchemaName = keyof typeof DefaultEventStoreApiSchemas;

export type EventStoreApiSchemas = Record<SchemaName, ContractSchema>;

/**
 * Structural wrappers composed from the named schemas, so replacing a named
 * schema also changes every collection and HAL representation using it.
 */
export const CompositeSchemas = {
  StreamCatalogPage: Type.Object({
    streams: Type.Array(schemaRef('ListedStream')),
    nextCursor: Type.Optional(
      Type.String({
        description: 'Opaque continuation token. Clients must not parse it.',
      }),
    ),
  }),
  StreamCatalogPageHal: Type.Object({
    _embedded: Type.Object({
      streams: Type.Array(
        Type.Intersect([schemaRef('ListedStream'), schemaRef('HalResource')]),
      ),
    }),
    _links: Type.Record(Type.String(), Type.Unknown()),
  }),
  MessagePage: Type.Object({
    streamName: Type.String(),
    currentStreamVersion: DecimalString(),
    messages: Type.Array(schemaRef('RecordedMessage')),
  }),
  MessagePageHal: Type.Object({
    streamName: Type.String(),
    currentStreamVersion: DecimalString(),
    _embedded: Type.Object({
      messages: Type.Array(
        Type.Intersect([
          schemaRef('RecordedMessage'),
          schemaRef('HalResource'),
        ]),
      ),
    }),
    _links: Type.Record(Type.String(), Type.Unknown()),
    _templates: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
};

export type CompositeSchemaName = keyof typeof CompositeSchemas;

export const Parameters = {
  DecimalString,
};
