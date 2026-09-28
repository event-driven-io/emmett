export type HttpMethod =
  'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * Framework-neutral HTTP request passed to portable route handlers.
 *
 * Framework adapters (Hono, Express, Fastify, ...) build it from their native
 * request, so handlers never depend on a specific web framework.
 */
export type PortableHttpRequest<Context = unknown> = {
  method: string;
  /** Full request URL as seen by the server. */
  url: URL;
  /** Effective root the API is mounted at, e.g. `/v1` or `/emmett/v1`. */
  apiRoot: string;
  /** Decoded path parameters. */
  params: Record<string, string>;
  headers: Headers;
  /** Raw request body, when it was not already consumed by host middleware. */
  body: ReadableStream<Uint8Array> | null;
  /** Body parsed by host middleware (e.g. `express.json()`), when available. */
  parsedBody?: unknown;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
  /** Host-specific data resolved by the adapter, e.g. the authenticated user. */
  context: Context;
};

export type PortableRouteHandler<Context = unknown> = (
  request: PortableHttpRequest<Context>,
) => Promise<Response>;

export type PortableRoute<Context = unknown> = {
  method: HttpMethod;
  /**
   * Path relative to the API root using `{name}` placeholders,
   * e.g. `/streams/{streamName}`. Empty string denotes the API root itself.
   */
  path: string;
  handler: PortableRouteHandler<Context>;
};

/**
 * Set of framework-neutral routes that framework adapters can mount.
 */
export type PortableApi<Context = unknown> = {
  /** Mount path used when the host does not configure one, e.g. `/v1`. */
  defaultMountPath: string;
  routes: PortableRoute<Context>[];
};

/**
 * Normalises a mount path: leading slash, no trailing slash, `''` for root.
 */
export const normalizeMountPath = (mountPath: string | undefined): string => {
  const trimmed = (mountPath ?? '').trim().replace(/\/+$/, '');

  if (trimmed === '') return '';

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export const joinRoutePath = (mountPath: string, path: string): string =>
  `${normalizeMountPath(mountPath)}${path}` || '/';

/**
 * Converts `{name}` placeholders into the `:name` syntax used by
 * Hono, Express and Fastify routers.
 */
export const toColonRoutePath = (path: string): string =>
  path.replace(/\{([^}]+)\}/g, ':$1');

/**
 * Derives the effective API root from the full route pattern matched by the
 * framework (including any host prefixes) and the portable route path.
 */
export const apiRootFromRoutePattern = (
  matchedPattern: string,
  route: Pick<PortableRoute, 'path'>,
): string => {
  const relative = toColonRoutePath(route.path);
  const pattern =
    matchedPattern.length > 1 ? matchedPattern.replace(/\/+$/, '') : '';

  return relative !== '' && pattern.endsWith(relative)
    ? pattern.slice(0, pattern.length - relative.length)
    : pattern;
};

export type ReadJSONBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'TOO_LARGE' | 'INVALID_JSON' | 'EMPTY' };

/**
 * Reads and parses a JSON request body, stopping as soon as it exceeds `maxBytes`.
 */
export const readJSONBody = async (
  request: Pick<PortableHttpRequest, 'body' | 'parsedBody' | 'headers'>,
  options: { maxBytes: number },
): Promise<ReadJSONBodyResult> => {
  if (request.parsedBody !== undefined)
    return { ok: true, value: request.parsedBody };

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes)
    return { ok: false, reason: 'TOO_LARGE' };

  if (!request.body) return { ok: false, reason: 'EMPTY' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > options.maxBytes) {
      await reader.cancel();
      return { ok: false, reason: 'TOO_LARGE' };
    }
    chunks.push(value);
  }

  if (size === 0) return { ok: false, reason: 'EMPTY' };

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }
};
