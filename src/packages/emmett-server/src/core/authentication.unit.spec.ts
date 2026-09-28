import type { PortableHttpRequest } from '@event-driven-io/emmett';
import { describe, expect, it } from 'vitest';
import {
  apiKeyAuthentication,
  generateApiKey,
  hashApiKey,
  hostAuthentication,
  insecureAuthentication,
} from './authentication';

const request = <Context = unknown>(
  headers: Record<string, string> = {},
  context?: Context,
): PortableHttpRequest<Context> => ({
  method: 'GET',
  url: new URL('http://localhost/v1'),
  apiRoot: '/v1',
  params: {},
  headers: new Headers(headers),
  body: null,
  signal: new AbortController().signal,
  context: context as Context,
});

void describe('apiKeyAuthentication', () => {
  void it('resolves the principal of a matching key', async () => {
    const apiKey = generateApiKey();
    const authenticate = apiKeyAuthentication({
      keys: [{ id: 'ci', sha256: await hashApiKey(apiKey), roles: ['editor'] }],
    });

    expect(await authenticate(request({ 'x-api-key': apiKey }))).toEqual({
      id: 'ci',
      authenticationMethod: 'api-key',
      roles: ['editor'],
    });
  });

  void it('does not authenticate unknown or missing keys', async () => {
    const authenticate = apiKeyAuthentication({
      keys: [
        { id: 'ci', sha256: await hashApiKey('secret'), roles: ['admin'] },
      ],
    });

    expect(
      await authenticate(request({ 'x-api-key': 'other' })),
    ).toBeUndefined();
    expect(await authenticate(request())).toBeUndefined();
  });

  void it('hashes keys with SHA-256', async () => {
    expect(await hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  void it('generates distinct, prefixed keys', () => {
    const first = generateApiKey();

    expect(first).toMatch(/^emt_[\da-f]{64}$/);
    expect(generateApiKey()).not.toBe(first);
  });
});

void describe('insecureAuthentication', () => {
  void it('warns when created and treats requests as administrators', async () => {
    const warnings: string[] = [];

    const authenticate = insecureAuthentication({
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('INSECURE');
    expect(await authenticate(request())).toMatchObject({
      authenticationMethod: 'insecure',
      roles: ['admin'],
    });
  });
});

void describe('hostAuthentication', () => {
  void it('maps the host context to a principal', async () => {
    const authenticate = hostAuthentication((context: { userId?: string }) =>
      context.userId
        ? {
            id: context.userId,
            authenticationMethod: 'host',
            roles: ['viewer'],
          }
        : undefined,
    );

    expect(await authenticate(request({}, { userId: 'u1' }))).toMatchObject({
      id: 'u1',
    });
    expect(await authenticate(request({}, {}))).toBeUndefined();
  });
});
