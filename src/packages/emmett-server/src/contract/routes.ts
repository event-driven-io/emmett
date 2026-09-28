import type { HttpMethod } from '@event-driven-io/emmett';
import { MediaTypes } from './mediaTypes';
import { schemaRef, type JSONSchema, type SchemaName } from './schemas';
import { Permissions, type Permission } from './security';

export const ApiVersion = '1';
export const ContractVersion = '1.0.0';
export const DefaultApiRoot = '/v1';

export type ParameterDescriptor = {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description: string;
  schema: JSONSchema;
};

export type ResponseDescriptor = {
  description: string;
  headers?: Record<string, { description: string; schema: JSONSchema }>;
  content?: Record<string, JSONSchema>;
};

export type RouteDescriptor = {
  operationId: EventStoreApiOperation;
  method: HttpMethod;
  /** Path relative to the API root, e.g. `/streams/{streamName}`. */
  path: string;
  summary: string;
  description?: string;
  tag: 'api' | 'streams';
  /** `undefined` means the route follows the documentation access policy. */
  permission: Permission;
  parameters?: ParameterDescriptor[];
  requestBody?: { required: boolean; content: Record<string, JSONSchema> };
  responses: Record<string, ResponseDescriptor>;
};

export type EventStoreApiOperation =
  | 'getApiRoot'
  | 'getOpenApiDocument'
  | 'getApiDocumentation'
  | 'listStreams'
  | 'getStream'
  | 'streamExists'
  | 'readMessages'
  | 'appendMessages';

export const DefaultLimits = {
  pageSize: 100,
  maxPageSize: 1000,
  maxAppendBatchSize: 1000,
  maxBodyBytes: 1024 * 1024,
} as const;

const problem = (description: string): ResponseDescriptor => ({
  description,
  content: { [MediaTypes.Problem]: schemaRef('ProblemDetails') },
});

const resource = (
  description: string,
  json: SchemaName,
  hal: JSONSchema = { allOf: [schemaRef(json), schemaRef('HalResource')] },
  headers?: ResponseDescriptor['headers'],
): ResponseDescriptor => ({
  description,
  ...(headers ? { headers } : {}),
  content: {
    [MediaTypes.JSON]: schemaRef(json),
    [MediaTypes.HAL]: hal,
    [MediaTypes.HALForms]: hal,
  },
});

const etagHeader = {
  ETag: {
    description:
      'Strong ETag whose opaque value is the current stream version, e.g. "42".',
    schema: { type: 'string' },
  },
} satisfies ResponseDescriptor['headers'];

const streamNameParameter: ParameterDescriptor = {
  name: 'streamName',
  in: 'path',
  required: true,
  description:
    'Opaque stream name, percent-encoded as a single URI path segment. The server does not impose a naming convention.',
  schema: { type: 'string', minLength: 1 },
};

const commonProblems = {
  '401': problem('Missing or invalid credentials.'),
  '403': problem(
    'Authenticated principal is not permitted to perform the operation.',
  ),
  '406': problem('Requested representation is not available.'),
};

export const EventStoreApiRoutes: RouteDescriptor[] = [
  {
    operationId: 'getApiRoot',
    method: 'GET',
    path: '',
    summary: 'API root with versions, capabilities and entry-point links',
    tag: 'api',
    permission: Permissions.discover,
    responses: {
      '200': resource('API root.', 'ApiRoot'),
      ...commonProblems,
    },
  },
  {
    operationId: 'getOpenApiDocument',
    method: 'GET',
    path: '/openapi.json',
    summary: 'OpenAPI 3.1 contract served by this API build',
    tag: 'api',
    permission: Permissions.discover,
    responses: {
      '200': {
        description: 'OpenAPI 3.1 document.',
        content: {
          [MediaTypes.JSON]: { type: 'object' },
          [MediaTypes.OpenApi]: { type: 'object' },
        },
      },
      ...commonProblems,
    },
  },
  {
    operationId: 'getApiDocumentation',
    method: 'GET',
    path: '/docs',
    summary: 'Human-facing API documentation',
    tag: 'api',
    permission: Permissions.discover,
    responses: {
      '200': {
        description: 'HTML documentation.',
        content: { [MediaTypes.HTML]: { type: 'string' } },
      },
      ...commonProblems,
    },
  },
  {
    operationId: 'listStreams',
    method: 'GET',
    path: '/streams',
    summary: 'Paginated and searchable stream catalog',
    description:
      'Requires a catalog-capable backend. Ordering and search semantics are declared in the API root capabilities.',
    tag: 'streams',
    permission: Permissions.listStreams,
    parameters: [
      {
        name: 'limit',
        in: 'query',
        description: `Maximum number of streams. Defaults to ${DefaultLimits.pageSize}, capped by the configured maximum (${DefaultLimits.maxPageSize} by default).`,
        schema: { type: 'integer', minimum: 1 },
      },
      {
        name: 'cursor',
        in: 'query',
        description: 'Opaque continuation token returned by the server.',
        schema: { type: 'string' },
      },
      {
        name: 'q',
        in: 'query',
        description: 'Backend-supported text search over stream names.',
        schema: { type: 'string' },
      },
      {
        name: 'streamType',
        in: 'query',
        description:
          'Structured stream-type filter, applied when the stream identity codec recognizes the name.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': resource(
        'Page of streams.',
        'StreamCatalogPage',
        schemaRef('StreamCatalogPageHal'),
      ),
      '400': problem('Invalid limit or cursor.'),
      ...commonProblems,
      '501': problem('Backend does not provide a stream catalog.'),
    },
  },
  {
    operationId: 'getStream',
    method: 'GET',
    path: '/streams/{streamName}',
    summary: 'Stream metadata and links',
    tag: 'streams',
    permission: Permissions.readStreams,
    parameters: [streamNameParameter],
    responses: {
      '200': resource('Stream metadata.', 'Stream', undefined, etagHeader),
      ...commonProblems,
      '404': problem('Stream does not exist.'),
    },
  },
  {
    operationId: 'streamExists',
    method: 'HEAD',
    path: '/streams/{streamName}',
    summary: 'Stream existence and current ETag',
    tag: 'streams',
    permission: Permissions.readStreams,
    parameters: [streamNameParameter],
    responses: {
      '200': { description: 'Stream exists.', headers: etagHeader },
      '401': { description: 'Missing or invalid credentials.' },
      '403': { description: 'Not permitted.' },
      '404': { description: 'Stream does not exist.' },
    },
  },
  {
    operationId: 'readMessages',
    method: 'GET',
    path: '/streams/{streamName}/messages',
    summary: 'Forward finite read as JSON, HAL, or RFC 7464 JSON text sequence',
    description:
      'With `Accept: application/json-seq` the selected range is streamed record by record and the response closes when the range ends. Live following belongs to subscriptions.',
    tag: 'streams',
    permission: Permissions.readStreams,
    parameters: [
      streamNameParameter,
      {
        name: 'from',
        in: 'query',
        description:
          'Inclusive stream position as a decimal string. Defaults to the beginning of the stream.',
        schema: schemaRef('DecimalString'),
      },
      {
        name: 'to',
        in: 'query',
        description: 'Inclusive upper stream position as a decimal string.',
        schema: schemaRef('DecimalString'),
      },
      {
        name: 'limit',
        in: 'query',
        description: `Maximum number of messages. For JSON and HAL defaults to ${DefaultLimits.pageSize}, capped by the configured maximum (${DefaultLimits.maxPageSize} by default). For JSON sequences there is no limit unless provided.`,
        schema: { type: 'integer', minimum: 1 },
      },
      {
        name: 'If-None-Match',
        in: 'header',
        description:
          'Returns 304 Not Modified when it matches the current stream ETag.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        ...resource(
          'Messages in the requested range.',
          'MessagePage',
          schemaRef('MessagePageHal'),
          etagHeader,
        ),
        content: {
          ...resource('', 'MessagePage', schemaRef('MessagePageHal')).content,
          [MediaTypes.JSONSequence]: schemaRef('RecordedMessage'),
        },
      },
      '304': { description: 'Stream has not changed.', headers: etagHeader },
      '400': problem('Invalid range, position or limit.'),
      ...commonProblems,
      '404': problem('Stream does not exist.'),
    },
  },
  {
    operationId: 'appendMessages',
    method: 'POST',
    path: '/streams/{streamName}/messages',
    summary: 'Append one or more messages with optimistic concurrency',
    description:
      'Optimistic concurrency uses conditional headers: `If-Match: "42"` expects exact version 42, `If-Match: *` expects the stream to exist, `If-None-Match: *` expects it not to exist, and omitting both disables the check.',
    tag: 'streams',
    permission: Permissions.appendMessages,
    parameters: [
      streamNameParameter,
      {
        name: 'If-Match',
        in: 'header',
        description: 'Single strong stream version ETag, e.g. "42", or `*`.',
        schema: { type: 'string' },
      },
      {
        name: 'If-None-Match',
        in: 'header',
        description: 'Only `*`, expecting the stream not to exist.',
        schema: { type: 'string', enum: ['*'] },
      },
    ],
    requestBody: {
      required: true,
      content: { [MediaTypes.JSON]: schemaRef('AppendRequest') },
    },
    responses: {
      '200': appendResponse('Messages appended to an existing stream.'),
      '201': appendResponse('Messages appended, creating a new stream.'),
      '400': problem('Invalid body or conditional headers.'),
      ...commonProblems,
      '412': problem('Expected stream version did not match.'),
      '413': problem('Body or batch too large.'),
      '415': problem('Body is not JSON.'),
    },
  },
];

function appendResponse(description: string): ResponseDescriptor {
  return {
    ...resource(description, 'AppendResult'),
    headers: {
      ...etagHeader,
      Location: {
        description: 'URL of the stream resource.',
        schema: { type: 'string' },
      },
    },
  };
}
