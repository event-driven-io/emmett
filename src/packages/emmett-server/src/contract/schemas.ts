/**
 * JSON Schema 2020-12 compatible definitions of the Event Store API resources.
 * They are the single source for both the OpenAPI document and runtime validation.
 */
export type JSONSchema = {
  $ref?: string;
  type?:
    'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: readonly (string | number | boolean)[];
  default?: unknown;
  allOf?: JSONSchema[];
  examples?: unknown[];
};

const ref = (name: string): JSONSchema => ({
  $ref: `#/components/schemas/${name}`,
});

const decimalString = (description: string): JSONSchema => ({
  type: 'string',
  pattern: '^(0|[1-9][0-9]*)$',
  description,
});

const halLinks: JSONSchema = {
  type: 'object',
  description: 'HAL links keyed by link relation type.',
  additionalProperties: true,
};

export const Schemas = {
  DecimalString: decimalString(
    'Non-negative integer encoded as a decimal string.',
  ),
  Link: {
    type: 'object',
    required: ['href'],
    properties: {
      href: { type: 'string' },
      templated: { type: 'boolean' },
      type: { type: 'string' },
      title: { type: 'string' },
      name: { type: 'string' },
    },
  },
  HalResource: {
    type: 'object',
    required: ['_links'],
    properties: {
      _links: halLinks,
      _embedded: { type: 'object', additionalProperties: true },
      _templates: {
        type: 'object',
        description:
          'HAL-FORMS templates, present only for authorized actions.',
        additionalProperties: true,
      },
    },
  },
  Capabilities: {
    type: 'object',
    required: [
      'streamReads',
      'appends',
      'streamExistence',
      'streamCatalog',
      'globalPosition',
      'finiteStreaming',
      'subscriptions',
      'subscriptionSources',
      'aggregates',
    ],
    properties: {
      streamReads: { type: 'boolean' },
      appends: { type: 'boolean' },
      streamExistence: { type: 'boolean' },
      streamCatalog: { type: 'boolean' },
      globalPosition: { type: 'boolean' },
      finiteStreaming: { type: 'boolean' },
      subscriptions: { type: 'boolean' },
      subscriptionSources: { type: 'array', items: { type: 'string' } },
      aggregates: { type: 'array', items: { type: 'string' } },
      catalog: {
        type: 'object',
        description: 'Stream catalog ordering and search semantics.',
        properties: {
          ordering: { type: 'string' },
          search: { type: 'string' },
        },
      },
    },
  },
  ApiRoot: {
    type: 'object',
    required: [
      'apiVersion',
      'contractVersion',
      'serverVersion',
      'capabilities',
    ],
    properties: {
      apiVersion: { type: 'string', examples: ['1'] },
      contractVersion: { type: 'string', examples: ['1.0.0'] },
      serverVersion: { type: 'string' },
      capabilities: ref('Capabilities'),
    },
  },
  StreamIdentity: {
    type: 'object',
    required: ['streamType', 'streamId'],
    properties: {
      streamType: { type: 'string' },
      streamId: { type: 'string' },
    },
  },
  Stream: {
    type: 'object',
    required: ['streamName'],
    properties: {
      streamName: { type: 'string' },
      currentStreamVersion: ref('DecimalString'),
      identity: ref('StreamIdentity'),
    },
  },
  StreamCatalogPage: {
    type: 'object',
    required: ['streams'],
    properties: {
      streams: { type: 'array', items: ref('Stream') },
      nextCursor: {
        type: 'string',
        description: 'Opaque continuation token. Clients must not parse it.',
      },
    },
  },
  StreamCatalogPageHal: {
    type: 'object',
    required: ['_embedded', '_links'],
    properties: {
      _embedded: {
        type: 'object',
        required: ['streams'],
        properties: {
          streams: {
            type: 'array',
            items: { allOf: [ref('Stream'), ref('HalResource')] },
          },
        },
      },
      _links: halLinks,
    },
  },
  AppendMessage: {
    type: 'object',
    required: ['type', 'data'],
    properties: {
      kind: { type: 'string', enum: ['Event', 'Command'], default: 'Event' },
      type: { type: 'string', minLength: 1 },
      data: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
    },
  },
  AppendRequest: {
    type: 'object',
    required: ['messages'],
    properties: {
      messages: {
        type: 'array',
        minItems: 1,
        items: ref('AppendMessage'),
      },
    },
  },
  AppendResult: {
    type: 'object',
    required: ['streamName', 'nextExpectedStreamVersion', 'createdNewStream'],
    properties: {
      streamName: { type: 'string' },
      nextExpectedStreamVersion: ref('DecimalString'),
      createdNewStream: { type: 'boolean' },
      lastEventGlobalPosition: {
        type: 'string',
        description: 'Present only when the backend provides it.',
      },
    },
  },
  RecordedMessageMetadata: {
    type: 'object',
    required: ['messageId', 'streamName', 'streamPosition'],
    additionalProperties: true,
    properties: {
      messageId: { type: 'string' },
      streamName: { type: 'string' },
      streamPosition: ref('DecimalString'),
      globalPosition: {
        type: 'string',
        description: 'Present only when supported and returned by the backend.',
      },
      checkpoint: {
        type: 'string',
        description: 'Present only when supported and returned by the backend.',
      },
    },
  },
  RecordedMessage: {
    type: 'object',
    required: ['kind', 'type', 'data', 'metadata'],
    properties: {
      kind: { type: 'string', enum: ['Event', 'Command'] },
      type: { type: 'string' },
      data: { type: 'object', additionalProperties: true },
      metadata: ref('RecordedMessageMetadata'),
    },
  },
  MessagePage: {
    type: 'object',
    required: ['streamName', 'currentStreamVersion', 'messages'],
    properties: {
      streamName: { type: 'string' },
      currentStreamVersion: ref('DecimalString'),
      messages: { type: 'array', items: ref('RecordedMessage') },
      nextFrom: {
        ...decimalString(
          'Stream position to pass as `from` to read the next page. Omitted when there are no more messages in the range.',
        ),
      },
    },
  },
  MessagePageHal: {
    type: 'object',
    required: ['streamName', 'currentStreamVersion', '_embedded', '_links'],
    properties: {
      streamName: { type: 'string' },
      currentStreamVersion: ref('DecimalString'),
      _embedded: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            items: { allOf: [ref('RecordedMessage'), ref('HalResource')] },
          },
        },
      },
      _links: halLinks,
      _templates: { type: 'object', additionalProperties: true },
    },
  },
  ProblemDetails: {
    type: 'object',
    required: ['type', 'title', 'status'],
    additionalProperties: true,
    properties: {
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string' },
      code: { type: 'string' },
      traceId: { type: 'string' },
    },
  },
} satisfies Record<string, JSONSchema>;

export type SchemaName = keyof typeof Schemas;

export const schemaRef = (name: SchemaName): JSONSchema => ref(name);
