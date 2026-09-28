import {
  apiRootFromRoutePattern,
  joinRoutePath,
  normalizeMountPath,
  toColonRoutePath,
  type PortableApi,
} from '@event-driven-io/emmett';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

export type PortableApiPluginOptions<ApiContext = unknown> = {
  api: PortableApi<ApiContext>;
  /** Path the API is mounted at. Defaults to the API's default mount path, e.g. `/v1`. */
  mountPath?: string;
  /** Maps the Fastify request (e.g. data decorated by host hooks) to the API context. */
  resolveContext?: (
    request: FastifyRequest,
  ) => ApiContext | Promise<ApiContext>;
};

/**
 * Fastify plugin serving framework-neutral routes.
 * It is encapsulated, so its body parsing setup does not affect host routes.
 *
 * ```ts
 * await app.register(portableApiPlugin, { api, mountPath: '/emmett/v1' });
 * ```
 */
export const portableApiPlugin = <ApiContext = unknown>(
  instance: FastifyInstance,
  options: PortableApiPluginOptions<ApiContext>,
): Promise<void> => {
  const { api, resolveContext } = options;
  const mountPath = normalizeMountPath(
    options.mountPath ?? api.defaultMountPath,
  );

  // Portable handlers read the raw body themselves, enforcing their own limits and media types
  instance.removeAllContentTypeParsers();
  instance.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });

  for (const route of api.routes) {
    instance.route({
      method: route.method,
      url: joinRoutePath(mountPath, toColonRoutePath(route.path)),
      exposeHeadRoute: false,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const abortController = new AbortController();
        reply.raw.once('close', () => {
          if (!reply.raw.writableFinished) abortController.abort();
        });

        const webResponse = await route.handler({
          method: request.method,
          url: new URL(
            request.raw.url ?? request.url,
            `${request.protocol}://${request.host}`,
          ),
          apiRoot: apiRootFromRoutePattern(
            request.routeOptions.url ?? '',
            route,
          ),
          params: request.params as Record<string, string>,
          headers: toHeaders(request),
          body:
            request.body instanceof Readable
              ? (Readable.toWeb(request.body) as ReadableStream<Uint8Array>)
              : null,
          signal: abortController.signal,
          context: resolveContext
            ? await resolveContext(request)
            : (undefined as ApiContext),
        });

        reply.status(webResponse.status);
        webResponse.headers.forEach((value, name) => {
          if (name !== 'set-cookie') void reply.header(name, value);
        });
        const cookies = webResponse.headers.getSetCookie();
        if (cookies.length > 0) void reply.header('set-cookie', cookies);

        return reply.send(
          webResponse.body ? Readable.fromWeb(webResponse.body) : undefined,
        );
      },
    });
  }

  return Promise.resolve();
};

const toHeaders = (request: FastifyRequest): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }

  return headers;
};
