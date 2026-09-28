import {
  EmmettError,
  ifNoneMatchSatisfied,
  isExpectedVersionConflictError,
  isJSONContentType,
  isProblemDetailsError,
  ProblemDetailsError,
  jsonSequenceStream,
  negotiateMediaType,
  parseStreamVersionPreconditions,
  problemDetailsResponse,
  readJSONBody,
  toStrongETag,
  type EventStore,
  type HttpHeadersInit,
  type PortableApi,
  type PortableHttpRequest,
  type PortableRoute,
  type ProblemDetails,
  type StreamPosition,
} from '@event-driven-io/emmett';
import {
  ApiVersion,
  composeEventStoreOpenApi,
  ContractVersion,
  DefaultApiRoot,
  DefaultLimits,
  eventStoreProblem,
  EventStoreApiRoutes,
  MediaTypes,
  MessagesMediaTypes,
  Permissions,
  ResourceMediaTypes,
  type EventStoreApiOperation,
  type EventStoreOpenApiOptions,
  type OpenApiDocument,
  type Permission,
  type Principal,
  type ProblemCode,
} from '../contract';
import type { PrincipalResolver } from './authentication';
import {
  roleBasedAuthorization,
  type AuthorizationRequest,
  type Authorize,
} from './authorization';
import { documentationPage } from './documentation';
import {
  apiLinks,
  appendTemplate,
  halLink,
  profileLink,
  Relations,
  withCuries,
  type ApiLinks,
} from './hypermedia';
import {
  parseAppendRequest,
  toDecimalString,
  toJSONText,
  toRecordedMessageRepresentation,
} from './messages';
import {
  fullReadStreamVersionReader,
  readMessagesPage,
  streamMessages,
  type StreamVersion,
  type StreamVersionReader,
} from './reading';
import type { StreamCatalog } from './streamCatalog';
import {
  typeIdStreamIdentityCodec,
  type StreamIdentity,
  type StreamIdentityCodec,
} from './streamIdentity';

export type EventStoreHttpApiLimits = {
  /** Default JSON and HAL page size for messages and streams. */
  defaultPageSize: number;
  /** Maximum JSON and HAL page size for messages and streams. */
  maxPageSize: number;
  /** Maximum number of messages in a single append. */
  maxAppendBatchSize: number;
  /** Maximum append body size in bytes. */
  maxBodyBytes: number;
  /** Number of messages read from the backend at once while streaming JSON sequences. */
  streamingPageSize: number;
};

export type OperationTelemetry = {
  traceId: string;
  operation: EventStoreApiOperation;
  outcome: 'success' | 'failure' | 'cancelled';
  status: number;
  durationMs: number;
  principalId?: string;
  authenticationMethod?: string;
  streamName?: string;
  streamType?: string;
  errorCode?: string;
};

export type EventStoreHttpApiOptions<HostContext = unknown> = {
  eventStore: EventStore;
  /**
   * Resolves the authenticated principal. Requests without a principal get `401`.
   * Use `apiKeyAuthentication`, `hostAuthentication` or, for local development only, `insecureAuthentication`.
   */
  authentication: PrincipalResolver<HostContext>;
  /** Authorization policy. Defaults to role-based permissions. */
  authorize?: Authorize;
  /** Optional backend capabilities beyond the base `EventStore` contract. */
  backend?: {
    streamCatalog?: StreamCatalog;
    /**
     * Reads stream existence and version without reading messages.
     * Defaults to a full stream read, which works everywhere but is costly for long streams.
     */
    readStreamVersion?: StreamVersionReader;
    /** Whether recorded messages carry global positions. */
    globalPosition?: boolean;
  };
  /** Structured stream name codec. Defaults to Emmett's `type:id` convention. Pass `null` to disable. */
  streamIdentityCodec?: StreamIdentityCodec | null;
  limits?: Partial<EventStoreHttpApiLimits>;
  documentation?: {
    /** Mounts `/openapi.json` and `/docs`. Defaults to `true`. */
    enabled?: boolean;
    /** Serves documentation without authentication. Event data stays protected. Defaults to `false`. */
    public?: boolean;
    /** Overrides the `service-desc` link, e.g. when the host serves a composed OpenAPI document. */
    serviceDescriptionHref?: string;
    /** Overrides the `describedby` link. */
    documentationHref?: string;
    /** Servers and security declarations for the served OpenAPI document. */
    openApi?: Pick<EventStoreOpenApiOptions, 'servers' | 'security'>;
  };
  serverVersion?: string;
  /** Deployment data passed to authorization, e.g. tenant or environment. */
  deployment?: Readonly<Record<string, unknown>>;
  observability?: {
    /** Called after every operation with safe, credential-free data. */
    onOperationCompleted?: (telemetry: OperationTelemetry) => void;
    /** Called for unexpected errors, which clients only see as `500` without details. */
    onError?: (error: unknown, telemetry: OperationTelemetry) => void;
    /** Includes stream names in telemetry. Defaults to `false`, as they can be high-cardinality or sensitive. */
    includeStreamNames?: boolean;
  };
};

type OperationContext<HostContext> = {
  request: PortableHttpRequest<HostContext>;
  operation: EventStoreApiOperation;
  principal: Principal;
  traceId: string;
  links: ApiLinks;
  isAllowed: (
    permission: Permission,
    details?: Partial<AuthorizationRequest>,
  ) => Promise<boolean>;
  demand: (
    permission: Permission,
    details?: Partial<AuthorizationRequest>,
  ) => Promise<void>;
  telemetry: Partial<OperationTelemetry>;
};

type OperationHandler<HostContext> = (
  context: OperationContext<HostContext>,
) => Promise<Response>;

const fail = (
  code: ProblemCode,
  detail?: string,
  headers?: HttpHeadersInit,
): never => {
  throw new ProblemDetailsError(eventStoreProblem(code, { detail }), {
    headers,
  });
};

const decimal = /^(0|[1-9]\d*)$/;
const positiveInteger = /^[1-9]\d*$/;

const traceIdOf = (headers: Headers): string => {
  const traceparent = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/.exec(
    headers.get('traceparent')?.trim() ?? '',
  );

  return traceparent?.[1] ?? crypto.randomUUID();
};

/**
 * Framework-neutral HTTP Event Store API.
 * Mount it with the Hono, Express or Fastify portable API adapters.
 *
 * ```ts
 * const api = eventStoreHttpApi({
 *   eventStore,
 *   authentication: apiKeyAuthentication({ keys }),
 * });
 *
 * registerPortableApi(app, api); // Hono, mounted at /v1
 * ```
 */
export const eventStoreHttpApi = <HostContext = unknown>(
  options: EventStoreHttpApiOptions<HostContext>,
): PortableApi<HostContext> => {
  const { eventStore } = options;
  const authorize = options.authorize ?? roleBasedAuthorization;
  const catalog = options.backend?.streamCatalog;
  const readStreamVersion =
    options.backend?.readStreamVersion ??
    fullReadStreamVersionReader(eventStore);
  const codec =
    options.streamIdentityCodec === null
      ? undefined
      : (options.streamIdentityCodec ?? typeIdStreamIdentityCodec);
  const limits: EventStoreHttpApiLimits = {
    defaultPageSize: DefaultLimits.pageSize,
    maxPageSize: DefaultLimits.maxPageSize,
    maxAppendBatchSize: DefaultLimits.maxAppendBatchSize,
    maxBodyBytes: DefaultLimits.maxBodyBytes,
    streamingPageSize: DefaultLimits.pageSize,
    ...options.limits,
  };
  const documentationEnabled = options.documentation?.enabled ?? true;
  const routes = EventStoreApiRoutes.filter(
    (route) =>
      documentationEnabled ||
      (route.operationId !== 'getOpenApiDocument' &&
        route.operationId !== 'getApiDocumentation'),
  );
  const openApiDocuments = new Map<string, OpenApiDocument>();

  const identityOf = (streamName: string): StreamIdentity | undefined =>
    codec?.parse(streamName);

  const capabilities = {
    streamReads: true,
    appends: true,
    streamExistence: true,
    streamCatalog: catalog !== undefined,
    globalPosition: options.backend?.globalPosition ?? false,
    finiteStreaming: true,
    subscriptions: false,
    subscriptionSources: [] as string[],
    aggregates: [] as string[],
    ...(catalog
      ? { catalog: { ordering: catalog.ordering, search: catalog.search } }
      : {}),
  };

  const serviceDescriptionHref = (links: ApiLinks) =>
    options.documentation?.serviceDescriptionHref ??
    (documentationEnabled ? links.openApi : undefined);
  const documentationHref = (links: ApiLinks) =>
    options.documentation?.documentationHref ??
    (documentationEnabled ? links.docs : undefined);

  const documentLinks = (links: ApiLinks) => {
    const describedBy = documentationHref(links);

    return {
      [Relations.describedBy]: describedBy
        ? { href: describedBy, type: MediaTypes.HTML }
        : undefined,
      [Relations.profile]: profileLink(),
    };
  };

  const negotiate = <MediaType extends string>(
    request: PortableHttpRequest<HostContext>,
    supported: readonly MediaType[],
  ): MediaType => {
    const mediaType = negotiateMediaType(
      request.headers.get('accept'),
      supported,
    );

    return (
      mediaType ??
      fail(
        'NOT_ACCEPTABLE',
        `Supported representations: ${supported.join(', ')}.`,
      )
    );
  };

  const respond = (
    body: unknown,
    options: {
      status?: number;
      mediaType: string;
      headers?: Record<string, string>;
    },
  ): Response =>
    new Response(toJSONText(body), {
      status: options.status ?? 200,
      headers: {
        'content-type': options.mediaType,
        vary: 'accept',
        ...options.headers,
      },
    });

  const isHal = (mediaType: string) =>
    mediaType === MediaTypes.HAL || mediaType === MediaTypes.HALForms;

  const requireStream = async (streamName: string): Promise<StreamVersion> => {
    const version = await readStreamVersion(streamName);

    return version.streamExists
      ? version
      : fail('STREAM_NOT_FOUND', `Stream '${streamName}' does not exist.`);
  };

  const notModified = (
    request: PortableHttpRequest<HostContext>,
    etag: string,
  ): Response | undefined =>
    ifNoneMatchSatisfied(request.headers.get('if-none-match'), etag)
      ? new Response(null, { status: 304, headers: { etag, vary: 'accept' } })
      : undefined;

  const parsePosition = (
    value: string | null,
    name: string,
  ): StreamPosition | undefined => {
    if (value === null) return undefined;

    return decimal.test(value)
      ? BigInt(value)
      : fail(
          'INVALID_RANGE',
          `'${name}' must be a non-negative integer encoded as a decimal string.`,
        );
  };

  const parseLimit = (
    value: string | null,
    fallback: number | undefined,
    max: number | undefined,
  ): number | undefined => {
    if (value === null) return fallback;

    if (!positiveInteger.test(value))
      return fail('INVALID_REQUEST', "'limit' must be a positive integer.");

    const limit = Number(value);

    return max !== undefined ? Math.min(limit, max) : limit;
  };

  const canAppend = (
    context: OperationContext<HostContext>,
    streamName: string,
  ) =>
    context.isAllowed(Permissions.appendMessages, {
      operation: 'appendMessages',
      streamName,
      ...(identityOf(streamName)
        ? { streamIdentity: identityOf(streamName)! }
        : {}),
    });

  //////////////////////////////////////
  /// Handlers
  //////////////////////////////////////

  const handlers: Record<
    EventStoreApiOperation,
    OperationHandler<HostContext>
  > = {
    getApiRoot: async ({ request, links, isAllowed }) => {
      const mediaType = negotiate(request, ResourceMediaTypes);
      const body = {
        apiVersion: ApiVersion,
        contractVersion: ContractVersion,
        serverVersion: options.serverVersion ?? ContractVersion,
        capabilities,
      };

      if (!isHal(mediaType)) return respond(body, { mediaType });

      const serviceDesc = serviceDescriptionHref(links);
      const canListStreams =
        catalog !== undefined && (await isAllowed(Permissions.listStreams));

      return respond(
        {
          ...body,
          _links: withCuries({
            [Relations.self]: halLink(links.root),
            [Relations.serviceDesc]: serviceDesc
              ? { href: serviceDesc, type: MediaTypes.OpenApi }
              : undefined,
            ...documentLinks(links),
            [Relations.streams]: canListStreams
              ? halLink(links.streams())
              : undefined,
          }),
        },
        { mediaType },
      );
    },

    getOpenApiDocument: ({ request }) => {
      const mediaType = negotiate(request, [
        MediaTypes.JSON,
        MediaTypes.OpenApi,
      ]);
      const apiRoot = request.apiRoot;

      let document = openApiDocuments.get(apiRoot);
      if (!document) {
        document = composeEventStoreOpenApi({
          apiRoot: apiRoot || DefaultApiRoot,
          namespace: '',
          routes,
          ...options.documentation?.openApi,
        });
        openApiDocuments.set(apiRoot, document);
      }

      return Promise.resolve(respond(document, { mediaType }));
    },

    getApiDocumentation: ({ request, links }) => {
      negotiate(request, [MediaTypes.HTML]);

      return Promise.resolve(
        new Response(
          documentationPage({
            apiRoot: request.apiRoot,
            openApiHref: serviceDescriptionHref(links) ?? links.openApi,
            routes,
          }),
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      );
    },

    listStreams: async ({ request, links }) => {
      const mediaType = negotiate(request, ResourceMediaTypes);

      if (!catalog)
        return fail(
          'NOT_IMPLEMENTED',
          'The configured backend does not provide a stream catalog.',
        );

      const search = request.url.searchParams;
      const limit = parseLimit(
        search.get('limit'),
        limits.defaultPageSize,
        limits.maxPageSize,
      )!;
      const cursor = search.get('cursor') ?? undefined;
      const q = search.get('q') ?? undefined;
      const streamType = search.get('streamType') ?? undefined;

      let result;
      try {
        result = await catalog.listStreams({ limit, cursor, q, streamType });
      } catch (error) {
        if (EmmettError.isInstanceOf(error, EmmettError.Codes.ValidationError))
          return fail('INVALID_CURSOR', 'Cursor is invalid or expired.');
        throw error;
      }

      const streams = result.streams.map((entry) => {
        const identity = identityOf(entry.streamName);

        return {
          streamName: entry.streamName,
          ...(entry.currentStreamVersion !== undefined
            ? { currentStreamVersion: entry.currentStreamVersion }
            : {}),
          ...(identity ? { identity } : {}),
        };
      });

      if (!isHal(mediaType))
        return respond(
          {
            streams,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          },
          { mediaType },
        );

      const filters = { q, streamType, limit };

      return respond(
        {
          _embedded: {
            streams: streams.map((stream) => ({
              ...stream,
              _links: {
                [Relations.self]: halLink(links.stream(stream.streamName)),
                [Relations.collection]: halLink(links.streams()),
                [Relations.messages]: {
                  href: links.messagesTemplate(stream.streamName),
                  templated: true,
                  type: MediaTypes.HAL,
                },
              },
            })),
          },
          _links: withCuries({
            [Relations.self]: halLink(links.streams({ ...filters, cursor })),
            [Relations.first]: halLink(links.streams(filters)),
            [Relations.next]: result.nextCursor
              ? halLink(
                  links.streams({ ...filters, cursor: result.nextCursor }),
                )
              : undefined,
            [Relations.find]: {
              href: links.streamsSearchTemplate,
              templated: true,
              type: MediaTypes.HAL,
            },
            [Relations.up]: halLink(links.root),
            ...documentLinks(links),
          }),
        },
        { mediaType },
      );
    },

    getStream: async (context) => {
      const { request, links } = context;
      const streamName = request.params.streamName!;
      const mediaType = negotiate(request, ResourceMediaTypes);

      const version = await requireStream(streamName);
      const etag = toStrongETag(version.currentStreamVersion);

      const unchanged = notModified(request, etag);
      if (unchanged) return unchanged;

      const identity = identityOf(streamName);
      const body = {
        streamName,
        currentStreamVersion: version.currentStreamVersion,
        ...(identity ? { identity } : {}),
      };

      if (!isHal(mediaType))
        return respond(body, { mediaType, headers: { etag } });

      const templates =
        mediaType === MediaTypes.HALForms &&
        (await canAppend(context, streamName))
          ? { _templates: appendTemplate(links.messages(streamName)) }
          : {};

      return respond(
        {
          ...body,
          _links: withCuries({
            [Relations.self]: halLink(links.stream(streamName)),
            [Relations.collection]: catalog
              ? halLink(links.streams())
              : undefined,
            [Relations.up]: halLink(links.root),
            [Relations.messages]: {
              href: links.messagesTemplate(streamName),
              templated: true,
              type: MediaTypes.HAL,
            },
            ...documentLinks(links),
            [Relations.profile]: profileLink('concurrency'),
          }),
          ...templates,
        },
        { mediaType, headers: { etag } },
      );
    },

    streamExists: async ({ request }) => {
      const version = await readStreamVersion(request.params.streamName!);

      return new Response(null, {
        status: version.streamExists ? 200 : 404,
        headers: version.streamExists
          ? { etag: toStrongETag(version.currentStreamVersion) }
          : {},
      });
    },

    readMessages: async (context) => {
      const { request, links } = context;
      const streamName = request.params.streamName!;
      const mediaType = negotiate(request, MessagesMediaTypes);
      const search = request.url.searchParams;
      const streaming = mediaType === MediaTypes.JSONSequence;

      const from = parsePosition(search.get('from'), 'from');
      const to = parsePosition(search.get('to'), 'to');
      const limit = streaming
        ? parseLimit(search.get('limit'), undefined, undefined)
        : parseLimit(
            search.get('limit'),
            limits.defaultPageSize,
            limits.maxPageSize,
          )!;

      if (from !== undefined && to !== undefined && to < from)
        return fail('INVALID_RANGE', "'to' must not be lower than 'from'.");

      const version = await requireStream(streamName);
      const etag = toStrongETag(version.currentStreamVersion);

      const unchanged = notModified(request, etag);
      if (unchanged) return unchanged;

      const range = { from: from ?? 0n, to };

      if (streaming)
        return new Response(
          jsonSequenceStream(
            streamMessages(eventStore, streamName, version, {
              ...range,
              limit,
              pageSize: limits.streamingPageSize,
              signal: request.signal,
            }),
            {
              signal: request.signal,
              serialize: (message) =>
                toJSONText(toRecordedMessageRepresentation(message)),
            },
          ),
          {
            headers: {
              'content-type': MediaTypes.JSONSequence,
              'cache-control': 'no-store',
              vary: 'accept',
              etag,
            },
          },
        );

      const page = await readMessagesPage(eventStore, streamName, version, {
        ...range,
        limit: limit!,
      });
      const messages = page.messages.map(toRecordedMessageRepresentation);
      const body = {
        streamName,
        currentStreamVersion: version.currentStreamVersion,
      };

      if (!isHal(mediaType))
        return respond(
          {
            ...body,
            messages,
            ...(page.nextFrom !== undefined ? { nextFrom: page.nextFrom } : {}),
          },
          { mediaType, headers: { etag } },
        );

      const view = (position: StreamPosition | undefined) =>
        halLink(
          links.messages(streamName, {
            from: position,
            to,
            limit,
          }),
        );
      const streamLink = halLink(links.stream(streamName));
      const templates =
        mediaType === MediaTypes.HALForms &&
        (await canAppend(context, streamName))
          ? { _templates: appendTemplate(links.messages(streamName)) }
          : {};

      return respond(
        {
          ...body,
          _embedded: {
            messages: messages.map((message) => ({
              ...message,
              _links: {
                [Relations.up]: streamLink,
                [Relations.stream]: streamLink,
              },
            })),
          },
          _links: withCuries({
            [Relations.self]: view(from),
            [Relations.first]: view(undefined),
            [Relations.next]:
              page.nextFrom !== undefined ? view(page.nextFrom) : undefined,
            [Relations.up]: streamLink,
            [Relations.stream]: streamLink,
            ...documentLinks(links),
          }),
          ...templates,
        },
        { mediaType, headers: { etag } },
      );
    },

    appendMessages: async (context) => {
      const { request, links, demand } = context;
      const streamName = request.params.streamName!;
      const streamIdentity = identityOf(streamName);
      const target = {
        streamName,
        ...(streamIdentity ? { streamIdentity } : {}),
      };

      const mediaType = negotiate(request, ResourceMediaTypes);

      await demand(Permissions.appendMessages, target);

      if (!isJSONContentType(request.headers.get('content-type')))
        return fail(
          'UNSUPPORTED_MEDIA_TYPE',
          `Append body must be sent as ${MediaTypes.JSON}.`,
        );

      const preconditions = parseStreamVersionPreconditions({
        ifMatch: request.headers.get('if-match'),
        ifNoneMatch: request.headers.get('if-none-match'),
      });
      if (!preconditions.ok)
        return fail('INVALID_CONDITIONAL_HEADER', preconditions.reason);

      const body = await readJSONBody(request, {
        maxBytes: limits.maxBodyBytes,
      });
      if (!body.ok)
        return body.reason === 'TOO_LARGE'
          ? fail(
              'CONTENT_TOO_LARGE',
              `Body must not exceed ${limits.maxBodyBytes} bytes.`,
            )
          : fail(
              'INVALID_REQUEST',
              body.reason === 'EMPTY'
                ? 'Body is required.'
                : 'Body is not valid JSON.',
            );

      const parsed = parseAppendRequest(body.value);
      if (!parsed.ok)
        return fail(
          'INVALID_REQUEST',
          parsed.errors
            .map(({ path, message }) => `${path} ${message}`)
            .join('; '),
        );

      if (parsed.messages.length > limits.maxAppendBatchSize)
        return fail(
          'CONTENT_TOO_LARGE',
          `A single append accepts at most ${limits.maxAppendBatchSize} messages.`,
        );

      await demand(Permissions.appendMessages, {
        ...target,
        messageTypes: [...new Set(parsed.messages.map(({ type }) => type))],
      });

      const result = await eventStore.appendToStream(
        streamName,
        parsed.messages as Parameters<EventStore['appendToStream']>[1],
        { expectedStreamVersion: preconditions.expectedStreamVersion },
      );

      const lastEventGlobalPosition =
        'lastEventGlobalPosition' in result
          ? toDecimalString(result.lastEventGlobalPosition)
          : undefined;

      const representation = {
        streamName,
        nextExpectedStreamVersion: result.nextExpectedStreamVersion,
        createdNewStream: result.createdNewStream,
        ...(lastEventGlobalPosition !== undefined
          ? { lastEventGlobalPosition }
          : {}),
      };
      const headers = {
        etag: toStrongETag(result.nextExpectedStreamVersion),
        location: links.stream(streamName),
      };
      const status = result.createdNewStream ? 201 : 200;

      if (!isHal(mediaType))
        return respond(representation, { mediaType, status, headers });

      return respond(
        {
          ...representation,
          _links: withCuries({
            [Relations.self]: halLink(links.stream(streamName)),
            [Relations.messages]: halLink(links.messages(streamName)),
          }),
        },
        { mediaType, status, headers },
      );
    },
  };

  //////////////////////////////////////
  /// Pipeline
  //////////////////////////////////////

  const toProblemResponse = (
    request: PortableHttpRequest<HostContext>,
    problem: ProblemDetails,
    headers?: HttpHeadersInit,
  ): Response =>
    request.method === 'HEAD'
      ? new Response(null, { status: problem.status, headers })
      : problemDetailsResponse(problem, { headers });

  const handleError = (
    error: unknown,
    request: PortableHttpRequest<HostContext>,
    telemetry: OperationTelemetry,
  ): Response => {
    const instance = request.url.pathname;
    const withRequestData = (problem: ProblemDetails): ProblemDetails => {
      if (problem.code) telemetry.errorCode = problem.code;

      return {
        ...problem,
        instance: problem.instance ?? instance,
        traceId: problem.traceId ?? telemetry.traceId,
      };
    };

    if (isProblemDetailsError(error))
      return toProblemResponse(
        request,
        withRequestData(error.problem),
        error.headers,
      );

    if (isExpectedVersionConflictError(error)) {
      const current =
        error.current !== undefined && decimal.test(error.current)
          ? error.current
          : undefined;

      return toProblemResponse(
        request,
        withRequestData(
          eventStoreProblem('EXPECTED_STREAM_VERSION_MISMATCH', {
            detail: `Expected version ${error.expected}; current version is ${current ?? 'unknown'}.`,
          }),
        ),
        current !== undefined ? { etag: toStrongETag(current) } : undefined,
      );
    }

    options.observability?.onError?.(error, telemetry);

    return toProblemResponse(
      request,
      withRequestData(eventStoreProblem('INTERNAL_ERROR')),
    );
  };

  const toPortableRoute = (
    operation: EventStoreApiOperation,
    method: PortableRoute['method'],
    path: string,
    permission: Permission,
  ): PortableRoute<HostContext> => ({
    method,
    path,
    handler: async (request) => {
      const startedAt = Date.now();
      const traceId = traceIdOf(request.headers);
      const streamName = request.params.streamName;
      const telemetry: OperationTelemetry = {
        traceId,
        operation,
        outcome: 'success',
        status: 200,
        durationMs: 0,
        ...(streamName !== undefined &&
        options.observability?.includeStreamNames
          ? { streamName }
          : {}),
        ...(streamName !== undefined && identityOf(streamName)
          ? { streamType: identityOf(streamName)!.streamType }
          : {}),
      };

      let response: Response;

      try {
        const isPublicDocumentation =
          options.documentation?.public === true &&
          (operation === 'getOpenApiDocument' ||
            operation === 'getApiDocumentation');

        const principal = isPublicDocumentation
          ? { id: 'anonymous', authenticationMethod: 'none', roles: [] }
          : await options.authentication(request);

        if (!principal) fail('UNAUTHENTICATED', 'Provide valid credentials.');

        telemetry.principalId = principal!.id;
        telemetry.authenticationMethod = principal!.authenticationMethod;

        const isAllowed = (
          requested: Permission,
          details?: Partial<AuthorizationRequest>,
        ) =>
          Promise.resolve(
            authorize({
              principal: principal!,
              operation,
              permission: requested,
              ...(streamName !== undefined ? { streamName } : {}),
              ...(streamName !== undefined && identityOf(streamName)
                ? { streamIdentity: identityOf(streamName)! }
                : {}),
              ...(options.deployment ? { deployment: options.deployment } : {}),
              ...details,
            }),
          );

        const context: OperationContext<HostContext> = {
          request,
          operation,
          principal: principal!,
          traceId,
          links: apiLinks(request.apiRoot),
          telemetry,
          isAllowed,
          demand: async (requested, details) => {
            if (!(await isAllowed(requested, details)))
              fail(
                'FORBIDDEN',
                `Principal is not permitted to perform '${operation}'.`,
              );
          },
        };

        if (!isPublicDocumentation) await context.demand(permission);

        response = await handlers[operation](context);
      } catch (error) {
        response = handleError(error, request, telemetry);
      }

      telemetry.status = response.status;
      telemetry.durationMs = Date.now() - startedAt;
      telemetry.outcome = request.signal.aborted
        ? 'cancelled'
        : response.status >= 400
          ? 'failure'
          : 'success';
      options.observability?.onOperationCompleted?.(telemetry);

      return response;
    },
  });

  return {
    defaultMountPath: DefaultApiRoot,
    routes: routes.map((route) =>
      toPortableRoute(
        route.operationId,
        route.method,
        route.path,
        route.permission,
      ),
    ),
  };
};
