import type { PortableHttpRequest } from '@event-driven-io/emmett';
import type { Permission, Principal, Role } from '../contract';

/**
 * Resolves the normalized principal for a request.
 * Returns `undefined` when the request is not authenticated.
 */
export type PrincipalResolver<HostContext = unknown> = (
  request: PortableHttpRequest<HostContext>,
) => Principal | undefined | Promise<Principal | undefined>;

/**
 * Uses the authentication already performed by the host application.
 * The adapter's `resolveContext` hook supplies the host data, and `map` turns it into a principal.
 * Emmett still authorizes every operation.
 */
export const hostAuthentication =
  <HostContext>(
    map: (
      context: HostContext,
    ) => Principal | undefined | Promise<Principal | undefined>,
  ): PrincipalResolver<HostContext> =>
  (request) =>
    map(request.context);

/**
 * Explicit insecure mode, treating every request as an administrator.
 * It warns once when created, as it must only be used for local development.
 */
export const insecureAuthentication = (options?: {
  roles?: Role[];
  warn?: (message: string) => void;
}): PrincipalResolver => {
  (options?.warn ?? console.warn)(
    'Emmett Server runs in INSECURE mode: every request is treated as an authenticated administrator. Do not expose it outside of local development.',
  );

  const principal: Principal = {
    id: 'anonymous',
    authenticationMethod: 'insecure',
    roles: options?.roles ?? ['admin'],
  };

  return () => principal;
};

export type ApiKeyDefinition = {
  /** Non-secret key identifier, used as the principal id. */
  id: string;
  /** Lowercase hex SHA-256 hash of the key. Plain keys are never stored. */
  sha256: string;
  roles: Role[];
  permissions?: Permission[];
};

export const ApiKeyHeader = 'x-api-key';

/**
 * Hashes an API key with SHA-256 using Web Crypto, returning lowercase hex.
 */
export const hashApiKey = async (apiKey: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(apiKey),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Generates a random API key with 256 bits of entropy.
 */
export const generateApiKey = (): string =>
  `emt_${[...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

const constantTimeEquals = (a: string, b: string) => {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return difference === 0;
};

/**
 * Authenticates requests using the `X-API-Key` header against hashed keys.
 */
export const apiKeyAuthentication = (options: {
  keys: ApiKeyDefinition[];
}): PrincipalResolver => {
  const keys = options.keys.map((key) => ({
    ...key,
    sha256: key.sha256.toLowerCase(),
  }));

  return async (request) => {
    const apiKey = request.headers.get(ApiKeyHeader);
    if (!apiKey) return undefined;

    const hash = await hashApiKey(apiKey);
    const key = keys.find((candidate) =>
      constantTimeEquals(candidate.sha256, hash),
    );
    if (!key) return undefined;

    return {
      id: key.id,
      authenticationMethod: 'api-key',
      roles: key.roles,
      ...(key.permissions ? { permissions: key.permissions } : {}),
    };
  };
};
