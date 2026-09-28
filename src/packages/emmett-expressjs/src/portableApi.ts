import {
  joinRoutePath,
  normalizeMountPath,
  toColonRoutePath,
  type PortableApi,
} from '@event-driven-io/emmett';
import { Router, type Request, type Response } from 'express';
import { once } from 'node:events';
import { Readable } from 'node:stream';

export type PortableApiRouterOptions<ApiContext = unknown> = {
  /** Path the API is mounted at. Defaults to the API's default mount path, e.g. `/v1`. */
  mountPath?: string;
  /** Maps the Express request (e.g. `req.user` set by host middleware) to the API context. */
  resolveContext?: (request: Request) => ApiContext | Promise<ApiContext>;
};

/**
 * Creates an Express router serving framework-neutral routes.
 *
 * ```ts
 * const app = express();
 * app.use(portableApiRouter(api, { mountPath: '/emmett/v1' }));
 * ```
 */
export const portableApiRouter = <ApiContext = unknown>(
  api: PortableApi<ApiContext>,
  options?: PortableApiRouterOptions<ApiContext>,
): Router => {
  const mountPath = normalizeMountPath(
    options?.mountPath ?? api.defaultMountPath,
  );
  const router = Router();
  const apiRouter = Router({ mergeParams: true });

  // HEAD routes go first, as Express otherwise answers HEAD with the GET handler
  const routes = [...api.routes].sort(
    (a, b) => Number(b.method === 'HEAD') - Number(a.method === 'HEAD'),
  );

  for (const route of routes) {
    apiRouter[route.method.toLowerCase() as 'get'](
      joinRoutePath('', toColonRoutePath(route.path)),
      async (request, response, next) => {
        const abortController = new AbortController();
        response.once('close', () => {
          if (!response.writableFinished) abortController.abort();
        });

        try {
          const webResponse = await route.handler({
            method: request.method,
            url: new URL(
              request.originalUrl,
              `${request.protocol}://${request.get('host') ?? 'localhost'}`,
            ),
            apiRoot: request.baseUrl,
            params: request.params as Record<string, string>,
            headers: toHeaders(request),
            body:
              request.body !== undefined || request.readableEnded
                ? null
                : (Readable.toWeb(request) as ReadableStream<Uint8Array>),
            parsedBody: request.body as unknown,
            signal: abortController.signal,
            context: options?.resolveContext
              ? await options.resolveContext(request)
              : (undefined as ApiContext),
          });

          await sendWebResponse(response, webResponse, abortController.signal);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  router.use(mountPath || '/', apiRouter);

  return router;
};

const toHeaders = (request: Request): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }

  return headers;
};

const sendWebResponse = async (
  response: Response,
  webResponse: globalThis.Response,
  signal: AbortSignal,
): Promise<void> => {
  response.status(webResponse.status);
  webResponse.headers.forEach((value, name) => {
    if (name !== 'set-cookie') response.setHeader(name, value);
  });
  const cookies = webResponse.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader('set-cookie', cookies);

  if (!webResponse.body) {
    response.end();
    return;
  }

  const reader = (webResponse.body as ReadableStream<Uint8Array>).getReader();

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!response.write(value))
        await Promise.race([once(response, 'drain'), once(response, 'close')]);
    }
  } finally {
    if (signal.aborted) await reader.cancel();
    else response.end();
  }
};
