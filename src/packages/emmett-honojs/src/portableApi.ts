import {
  apiRootFromRoutePattern,
  joinRoutePath,
  normalizeMountPath,
  toColonRoutePath,
  type PortableApi,
  type PortableRoute,
} from '@event-driven-io/emmett';
import type { Context, Env, Hono } from 'hono';

export type RegisterPortableApiOptions<
  ApiContext = unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  E extends Env = any,
> = {
  /** Path the API is mounted at. Defaults to the API's default mount path, e.g. `/v1`. */
  mountPath?: string;
  /** Maps the Hono context (e.g. the authenticated user set by host middleware) to the API context. */
  resolveContext?: (context: Context<E>) => ApiContext | Promise<ApiContext>;
};

/**
 * Registers framework-neutral routes in a Hono application.
 *
 * ```ts
 * const app = new Hono();
 * registerPortableApi(app, api, { mountPath: '/emmett/v1' });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registerPortableApi = <ApiContext = unknown, E extends Env = any>(
  application: Hono<E>,
  api: PortableApi<ApiContext>,
  options?: RegisterPortableApiOptions<ApiContext, E>,
): Hono<E> => {
  const mountPath = normalizeMountPath(
    options?.mountPath ?? api.defaultMountPath,
  );

  for (const route of api.routes) {
    application.on(
      route.method,
      joinRoutePath(mountPath, toColonRoutePath(route.path)),
      async (context) =>
        route.handler({
          method: context.req.method,
          url: new URL(context.req.url),
          apiRoot: apiRootFromRoutePattern(context.req.routePath, route),
          params: routeParams(route, (name) => context.req.param(name)),
          headers: context.req.raw.headers,
          body: context.req.raw.bodyUsed ? null : context.req.raw.body,
          signal: context.req.raw.signal,
          context: options?.resolveContext
            ? await options.resolveContext(context)
            : (undefined as ApiContext),
        }),
    );
  }

  return application;
};

const routeParams = (
  route: PortableRoute<never>,
  param: (name: string) => string | undefined,
): Record<string, string> =>
  Object.fromEntries(
    [...route.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [
      name!,
      param(name!) ?? '',
    ]),
  );
