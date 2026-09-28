import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  composeEventStoreOpenApi,
  eventStoreOpenApiDocument,
  type OpenApiDocument,
} from './openApi';

const collectRefs = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (value === null || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, item]) =>
    key === '$ref' && typeof item === 'string' ? [item] : collectRefs(item),
  );
};

const resolves = (document: OpenApiDocument, ref: string) => {
  const [, section, name] = /^#\/components\/([^/]+)\/(.+)$/.exec(ref) ?? [];
  return (
    section !== undefined &&
    name !== undefined &&
    document.components?.[section]?.[name] !== undefined
  );
};

const operations = (document: OpenApiDocument) =>
  Object.values(document.paths ?? {}).flatMap((pathItem) =>
    Object.values(pathItem as Record<string, { operationId: string }>),
  );

void describe('Event Store OpenAPI document', () => {
  void it('matches the published openapi/v1.json, so contract changes are explicit', () => {
    const published = JSON.parse(
      fs.readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '../../openapi/v1.json',
        ),
        'utf-8',
      ),
    ) as unknown;

    expect(
      eventStoreOpenApiDocument(),
      'Contract changed. Review it and run `npm run openapi:generate -w packages/emmett-server`.',
    ).toEqual(published);
  });

  void it('is an OpenAPI 3.1 document rooted at /v1 whose references all resolve', () => {
    const document = eventStoreOpenApiDocument();

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths!).every((p) => p.startsWith('/v1'))).toBe(
      true,
    );
    for (const ref of collectRefs(document))
      expect(resolves(document, ref), ref).toBe(true);
  });

  void it('rebases every path to the configured API root', () => {
    const document = composeEventStoreOpenApi({ apiRoot: '/emmett/v1' });

    expect(Object.keys(document.paths!)).toEqual(
      expect.arrayContaining([
        '/emmett/v1',
        '/emmett/v1/streams',
        '/emmett/v1/streams/{streamName}',
        '/emmett/v1/streams/{streamName}/messages',
      ]),
    );
    expect(
      Object.keys(document.paths!).every((p) => p.startsWith('/emmett/v1')),
    ).toBe(true);
  });

  void it('rejects an API root without the version segment', () => {
    expect(() => composeEventStoreOpenApi({ apiRoot: '/emmett' })).toThrow(
      /must keep 'v1'/,
    );
  });

  void it('namespaces operations, components, tags and security schemes', () => {
    const document = composeEventStoreOpenApi({
      apiRoot: '/emmett/v1',
      namespace: 'emmett',
    });

    expect(
      operations(document).every((o) => o.operationId.startsWith('emmett.')),
    ).toBe(true);
    expect(
      Object.keys(document.components!.schemas!).every((key) =>
        key.startsWith('emmett.'),
      ),
    ).toBe(true);
    expect(Object.keys(document.components!.securitySchemes!)).toEqual([
      'emmett.apiKey',
      'emmett.bearer',
    ]);
    expect(document.tags!.map((tag) => tag.name)).toEqual([
      'emmett.api',
      'emmett.streams',
    ]);
    for (const ref of collectRefs(document)) {
      expect(ref).toMatch(/^#\/components\/schemas\/emmett\./);
      expect(resolves(document, ref), ref).toBe(true);
    }
  });

  void it('merges into a host document, keeping host definitions', () => {
    const host: OpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Shop API', version: '2.0.0' },
      servers: [{ url: 'https://shop.example.com' }],
      tags: [{ name: 'carts' }],
      paths: { '/carts': { get: { operationId: 'listCarts', responses: {} } } },
      components: { schemas: { Cart: { type: 'object' } } },
    };

    const document = composeEventStoreOpenApi({
      apiRoot: '/emmett/v1',
      hostDocument: host,
    });

    expect(document.info.title).toBe('Shop API');
    expect(document.servers).toEqual(host.servers);
    expect(document.paths!['/carts']).toEqual(host.paths!['/carts']);
    expect(document.paths!['/emmett/v1/streams']).toBeDefined();
    expect(document.components!.schemas!.Cart).toEqual({ type: 'object' });
    expect(document.components!.schemas!['emmett.Stream']).toBeDefined();
    expect(document.tags!.map((tag) => tag.name)).toEqual([
      'carts',
      'emmett.api',
      'emmett.streams',
    ]);
    expect(host.paths!['/emmett/v1/streams']).toBeUndefined();
  });

  void it('reports collisions instead of overwriting host definitions', () => {
    const host: OpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Shop API', version: '2.0.0' },
      paths: {
        '/emmett/v1/streams': { get: { operationId: 'emmett.getApiRoot' } },
      },
      components: { schemas: { 'emmett.Stream': { type: 'string' } } },
    };

    const compose = () =>
      composeEventStoreOpenApi({ apiRoot: '/emmett/v1', hostDocument: host });

    expect(compose).toThrow(/path GET \/emmett\/v1\/streams/);
    expect(compose).toThrow(/operationId emmett\.getApiRoot/);
    expect(compose).toThrow(/component schemas\.emmett\.Stream/);
  });

  void it('uses host-supplied servers and security without changing schemas', () => {
    const document = composeEventStoreOpenApi({
      apiRoot: '/emmett/v1',
      servers: [{ url: 'https://events.example.com' }],
      security: {
        schemes: { hostSession: { type: 'apiKey', in: 'cookie', name: 'sid' } },
        requirements: [{ hostSession: [] }],
      },
    });

    expect(document.servers).toEqual([{ url: 'https://events.example.com' }]);
    expect(document.components!.securitySchemes).toEqual({
      hostSession: { type: 'apiKey', in: 'cookie', name: 'sid' },
    });
    expect(
      operations(document).every(
        (operation) =>
          JSON.stringify((operation as { security?: unknown }).security) ===
          JSON.stringify([{ hostSession: [] }]),
      ),
    ).toBe(true);
    expect(document.components!.schemas).toEqual(
      eventStoreOpenApiDocument().components!.schemas,
    );
  });
});
