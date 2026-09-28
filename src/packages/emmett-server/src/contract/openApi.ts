import { EmmettError } from '@event-driven-io/emmett';
import type { TSchema } from 'typebox';
import {
  ApiVersion,
  ContractVersion,
  DefaultApiRoot,
  EventStoreApiRoutes,
  type ParameterDescriptor,
  type ResponseDescriptor,
  type RouteDescriptor,
} from './routes';
import {
  CompositeSchemas,
  DefaultEventStoreApiSchemas,
  type EventStoreApiSchemas,
} from './schemas';
import { toJSONSchema } from './standardSchema';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    [key: string]: unknown;
  };
  servers?: { url: string; description?: string }[];
  paths?: Record<string, Record<string, any>>;
  components?: Record<string, Record<string, any>>;
  security?: Record<string, string[]>[];
  tags?: { name: string; description?: string }[];
  [key: string]: unknown;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SecurityScheme = Record<string, unknown>;
export type SecurityRequirement = Record<string, string[]>;

export const DefaultSecuritySchemes: Record<string, SecurityScheme> = {
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key managed through the server configuration.',
  },
  bearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'OIDC access token issued by a configured external issuer.',
  },
};

const tagDescriptions: Record<RouteDescriptor['tag'], string> = {
  api: 'API discovery and documentation',
  streams: 'Streams and their messages',
};

export type EventStoreOpenApiOptions = {
  /**
   * Effective API root. It must keep `v1` as its last segment, e.g. `/emmett/v1`.
   * Defaults to `/v1`.
   */
  apiRoot?: string;
  /**
   * Prefix added to operation ids, component keys, tags and security scheme ids.
   * Defaults to no prefix for an Emmett-only document and to `emmett` when merging into a host document.
   */
  namespace?: string;
  /** Host OpenAPI 3.1 document to merge Emmett operations and components into. */
  hostDocument?: OpenApiDocument;
  /** Deployment-specific servers. */
  servers?: OpenApiDocument['servers'];
  /**
   * Host-supplied security declarations replacing Emmett's API key and bearer schemes.
   * Schemes are added as is, so requirements can reference host-owned schemes.
   */
  security?: {
    schemes?: Record<string, SecurityScheme>;
    requirements: SecurityRequirement[];
  };
  /** Routes to describe. Defaults to all Event Store API routes. */
  routes?: RouteDescriptor[];
  /** Schemas replacing the default ones. They must implement Standard JSON Schema. */
  schemas?: Partial<EventStoreApiSchemas>;
};

/**
 * Canonical standalone OpenAPI 3.1 document for the Event Store API v1.
 */
export const eventStoreOpenApiDocument = (): OpenApiDocument =>
  composeEventStoreOpenApi({ apiRoot: DefaultApiRoot, namespace: '' });

/**
 * Produces the OpenAPI document for a configured API root. It either returns an
 * Emmett-only document, or merges Emmett operations into a host document,
 * reporting path, operation and component collisions instead of overwriting them.
 */
export const composeEventStoreOpenApi = (
  options?: EventStoreOpenApiOptions,
): OpenApiDocument => {
  const apiRoot = options?.apiRoot ?? DefaultApiRoot;
  const namespace =
    options?.namespace ?? (options?.hostDocument ? 'emmett' : '');
  const routes = options?.routes ?? EventStoreApiRoutes;

  if (!new RegExp(`/v${ApiVersion}$`).test(apiRoot))
    throw new EmmettError({
      errorCode: EmmettError.Codes.ValidationError,
      message: `API root '${apiRoot}' must keep 'v${ApiVersion}' as its last path segment.`,
    });

  const name = (key: string) => (namespace ? `${namespace}.${key}` : key);
  const rewriteRefs = <T>(value: T): T => rewriteSchemaRefs(value, name);

  const securitySchemes = options?.security
    ? (options.security.schemes ?? {})
    : Object.fromEntries(
        Object.entries(DefaultSecuritySchemes).map(([key, scheme]) => [
          name(key),
          scheme,
        ]),
      );
  const security: SecurityRequirement[] = options?.security
    ? options.security.requirements
    : Object.keys(DefaultSecuritySchemes).map((key) => ({ [name(key)]: [] }));

  const paths: NonNullable<OpenApiDocument['paths']> = {};
  for (const route of routes) {
    const path = `${apiRoot}${route.path}`;
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = rewriteRefs(
      toOperation(route, name, security),
    );
  }

  const usedTags = [...new Set(routes.map((route) => route.tag))];

  const emmettDocument: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title: 'Emmett Event Store API',
      version: ContractVersion,
      description:
        'Language-neutral HTTP API exposing Emmett event stores: discover streams, inspect them, read messages, and append with optimistic concurrency.',
    },
    ...(options?.servers ? { servers: options.servers } : {}),
    tags: usedTags.map((tag) => ({
      name: name(tag),
      description: tagDescriptions[tag],
    })),
    paths,
    components: {
      schemas: Object.fromEntries(
        [
          ...Object.entries({
            ...DefaultEventStoreApiSchemas,
            ...options?.schemas,
          }).map(([key, schema]): [string, Record<string, unknown>] => [
            key,
            toJSONSchema(schema),
          ]),
          ...Object.entries(CompositeSchemas),
        ].map(([key, schema]) => [name(key), rewriteRefs(schema)]),
      ),
      securitySchemes,
    },
  };

  return options?.hostDocument
    ? mergeIntoHostDocument(
        options.hostDocument,
        emmettDocument,
        options.servers,
      )
    : emmettDocument;
};

const toOperation = (
  route: RouteDescriptor,
  name: (key: string) => string,
  security: SecurityRequirement[],
) => ({
  operationId: name(route.operationId),
  summary: route.summary,
  ...(route.description ? { description: route.description } : {}),
  tags: [name(route.tag)],
  ...(route.parameters && route.parameters.length > 0
    ? { parameters: route.parameters.map(toParameter) }
    : {}),
  ...(route.requestBody
    ? {
        requestBody: {
          required: route.requestBody.required,
          content: mapContent(route.requestBody.content),
        },
      }
    : {}),
  responses: Object.fromEntries(
    Object.entries(route.responses).map(([status, response]) => [
      status,
      toResponse(response),
    ]),
  ),
  security,
});

const toParameter = (parameter: ParameterDescriptor) => ({
  name: parameter.name,
  in: parameter.in,
  required: parameter.required ?? false,
  description: parameter.description,
  schema: parameter.schema,
});

const toResponse = (response: ResponseDescriptor) => ({
  description: response.description,
  ...(response.headers ? { headers: response.headers } : {}),
  ...(response.content ? { content: mapContent(response.content) } : {}),
});

const mapContent = (content: Record<string, TSchema>) =>
  Object.fromEntries(
    Object.entries(content).map(([mediaType, schema]) => [
      mediaType,
      { schema },
    ]),
  );

const schemaRefPrefix = '#/components/schemas/';

const rewriteSchemaRefs = <T>(value: T, name: (key: string) => string): T => {
  if (Array.isArray(value))
    return value.map((item) => rewriteSchemaRefs(item, name) as unknown) as T;

  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' &&
      typeof item === 'string' &&
      item.startsWith(schemaRefPrefix)
        ? `${schemaRefPrefix}${name(item.slice(schemaRefPrefix.length))}`
        : rewriteSchemaRefs(item, name),
    ]),
  ) as T;
};

const mergeIntoHostDocument = (
  host: OpenApiDocument,
  emmett: OpenApiDocument,
  servers: OpenApiDocument['servers'],
): OpenApiDocument => {
  const collisions: string[] = [];

  const hostOperationIds = new Set(
    Object.values(host.paths ?? {}).flatMap((pathItem) =>
      Object.values(pathItem)
        .map(
          (operation) => (operation as { operationId?: string })?.operationId,
        )
        .filter((id): id is string => typeof id === 'string'),
    ),
  );

  const paths = { ...(host.paths ?? {}) };
  for (const [path, pathItem] of Object.entries(emmett.paths ?? {})) {
    const hostPathItem = paths[path];

    for (const [method, operation] of Object.entries(pathItem)) {
      if (hostPathItem?.[method] !== undefined)
        collisions.push(`path ${method.toUpperCase()} ${path}`);

      const operationId = (operation as { operationId: string }).operationId;
      if (hostOperationIds.has(operationId))
        collisions.push(`operationId ${operationId}`);
    }

    paths[path] = { ...(hostPathItem ?? {}), ...pathItem };
  }

  const components = { ...(host.components ?? {}) };
  for (const [section, entries] of Object.entries(emmett.components ?? {})) {
    const hostSection = components[section] ?? {};

    for (const key of Object.keys(entries))
      if (hostSection[key] !== undefined)
        collisions.push(`component ${section}.${key}`);

    components[section] = { ...hostSection, ...entries };
  }

  if (collisions.length > 0)
    throw new EmmettError({
      errorCode: EmmettError.Codes.ValidationError,
      message: `Cannot merge Emmett OpenAPI into the host document, found collisions: ${collisions.join('; ')}`,
    });

  const hostTags = host.tags ?? [];
  const tags = [
    ...hostTags,
    ...(emmett.tags ?? []).filter(
      (tag) => !hostTags.some((hostTag) => hostTag.name === tag.name),
    ),
  ];

  return {
    ...host,
    ...(servers ? { servers } : {}),
    tags,
    paths,
    components,
  };
};
