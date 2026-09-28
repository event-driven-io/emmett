/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
 * Assertions navigate untyped JSON response bodies, as a non-TypeScript client would.
 */
import {
  getInMemoryEventStore,
  type EventStore,
  type PortableApi,
} from '@event-driven-io/emmett';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaTypes, type Role } from '../contract';
import {
  eventStoreHttpApi,
  hostAuthentication,
  inMemoryStreamCatalog,
  type EventStoreHttpApiOptions,
} from '../core';

/**
 * Data the host's own authentication middleware exposes to Emmett.
 * Conformance hosts set it from the `x-test-user` header, e.g. `x-test-user: editor`.
 */
export type ConformanceHostContext = { user?: { id: string; role: Role } };

export const ConformanceUserHeader = 'x-test-user';

export type ConformanceHostSetup = {
  api: PortableApi<ConformanceHostContext>;
  /** Mount path passed to the adapter, `undefined` for the adapter default. */
  mountPath: string | undefined;
  /** Prefix under which the host mounts the adapter's router/plugin, e.g. `/api`. */
  hostPrefix: string | undefined;
};

export type RunningConformanceHost = {
  /** Base URL of the running server, e.g. `http://127.0.0.1:1234`. */
  baseUrl: string;
  close: () => Promise<void>;
};

/**
 * Framework host exercised by the conformance suite. It must:
 * - run authentication middleware setting `ConformanceHostContext.user` from the `x-test-user` header,
 * - mount the API with the adapter, passing `mountPath` and mapping its context through `resolveContext`,
 * - mount the adapter under `hostPrefix` when provided,
 * - serve its own `GET /host/health` route to prove Emmett coexists with host routes.
 */
export type ConformanceHost = {
  name: string;
  start: (setup: ConformanceHostSetup) => Promise<RunningConformanceHost>;
};

type ApiOverrides = Partial<
  Omit<EventStoreHttpApiOptions<ConformanceHostContext>, 'eventStore'>
> & { eventStore?: EventStore; withoutCatalog?: boolean };

const mountConfigurations = [
  {
    name: 'default mount path',
    mountPath: undefined,
    hostPrefix: undefined,
    apiRoot: '/v1',
  },
  {
    name: 'custom mount path under a host prefix',
    mountPath: '/emmett/v1',
    hostPrefix: '/api',
    apiRoot: '/api/emmett/v1',
  },
];

const readSequence = async (response: Response): Promise<unknown[]> => {
  const text = await response.text();

  expect(text.startsWith('\u001e')).toBe(true);

  return text
    .split('\u001e')
    .filter((record) => record !== '')
    .map((record) => {
      expect(record.endsWith('\n')).toBe(true);
      return JSON.parse(record) as unknown;
    });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * Host-independent HTTP conformance suite for the Event Store API.
 * Run it for every framework adapter and runtime host.
 */
export const eventStoreHttpApiConformanceSuite = (host: ConformanceHost) =>
  describe.each(mountConfigurations)(
    `Event Store HTTP API on ${host.name} with $name`,
    ({ mountPath, hostPrefix, apiRoot }) => {
      const running: RunningConformanceHost[] = [];

      afterEach(async () => {
        await Promise.all(running.splice(0).map((server) => server.close()));
      });

      const start = async (overrides?: ApiOverrides) => {
        const catalog = inMemoryStreamCatalog();
        const eventStore =
          overrides?.eventStore ??
          getInMemoryEventStore({
            hooks: { onAfterCommit: catalog.onAfterCommit },
          });

        const api = eventStoreHttpApi<ConformanceHostContext>({
          eventStore,
          authentication: hostAuthentication(({ user }) =>
            user
              ? {
                  id: user.id,
                  authenticationMethod: 'host',
                  roles: [user.role],
                }
              : undefined,
          ),
          backend: {
            globalPosition: true,
            ...(overrides?.withoutCatalog ? {} : { streamCatalog: catalog }),
          },
          ...overrides,
        });

        const server = await host.start({ api, mountPath, hostPrefix });
        running.push(server);

        const request = (
          path: string,
          init?: RequestInit & { as?: Role | 'anonymous' },
        ) => {
          const headers = new Headers(init?.headers);
          const role = init?.as ?? 'admin';
          if (role !== 'anonymous') headers.set(ConformanceUserHeader, role);

          return fetch(`${server.baseUrl}${path}`, { ...init, headers });
        };

        const append = (
          streamName: string,
          messages: Json[],
          init?: RequestInit & { as?: Role | 'anonymous' },
        ) =>
          request(
            `${apiRoot}/streams/${encodeURIComponent(streamName)}/messages`,
            {
              method: 'POST',
              body: JSON.stringify({ messages }),
              ...init,
              headers: {
                'content-type': 'application/json',
                ...(init?.headers as Record<string, string>),
              },
            },
          );

        return { request, append, eventStore, server };
      };

      const orderPlaced = (orderId: string, extra?: Json) => ({
        type: 'OrderPlaced',
        data: { orderId },
        ...extra,
      });

      const appendMany = async (
        append: Awaited<ReturnType<typeof start>>['append'],
        streamName: string,
        count: number,
      ) => {
        const response = await append(
          streamName,
          Array.from({ length: count }, (_, index) => ({
            type: 'ItemAdded',
            data: { index: index + 1 },
          })),
        );
        expect(response.status).toBe(201);
      };

      describe('API root', () => {
        it('returns versions and capabilities as JSON by default', async () => {
          const { request } = await start();

          const response = await request(apiRoot);

          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toContain(
            MediaTypes.JSON,
          );
          const body = (await response.json()) as Json;
          expect(body).toMatchObject({
            apiVersion: '1',
            contractVersion: '1.0.0',
            capabilities: {
              streamReads: true,
              appends: true,
              streamExistence: true,
              streamCatalog: true,
              globalPosition: true,
              finiteStreaming: true,
              subscriptions: false,
            },
          });
          expect(body._links).toBeUndefined();
        });

        it('links to entry points relative to the effective API root in HAL', async () => {
          const { request } = await start();

          const response = await request(apiRoot, {
            headers: { accept: MediaTypes.HAL },
          });

          expect(response.headers.get('content-type')).toContain(
            MediaTypes.HAL,
          );
          const { _links } = (await response.json()) as Json;
          expect(_links.self.href).toBe(apiRoot);
          expect(_links['service-desc'].href).toBe(`${apiRoot}/openapi.json`);
          expect(_links.describedby.href).toBe(`${apiRoot}/docs`);
          expect(_links.profile.href).toBeDefined();
          expect(_links['emmett:streams'].href).toBe(`${apiRoot}/streams`);
          expect(_links['emmett:subscriptions']).toBeUndefined();
          expect(_links.curies[0].name).toBe('emmett');
        });

        it('omits links to unavailable capabilities', async () => {
          const { request } = await start({ withoutCatalog: true });

          const response = await request(apiRoot, {
            headers: { accept: MediaTypes.HAL },
          });

          const body = (await response.json()) as Json;
          expect(body.capabilities.streamCatalog).toBe(false);
          expect(body._links['emmett:streams']).toBeUndefined();
        });

        it('coexists with host routes', async () => {
          const { request } = await start();

          const response = await request('/host/health');

          expect(response.status).toBe(200);
        });
      });

      describe('authentication and authorization', () => {
        it('returns 401 Problem Details without a principal', async () => {
          const { request } = await start();

          const response = await request(apiRoot, { as: 'anonymous' });

          expect(response.status).toBe(401);
          expect(response.headers.get('content-type')).toContain(
            MediaTypes.Problem,
          );
          expect(await response.json()).toMatchObject({
            status: 401,
            code: 'UNAUTHENTICATED',
            instance: apiRoot,
          });
        });

        it('returns 403 when a viewer appends', async () => {
          const { append } = await start();

          const response = await append('order:1', [orderPlaced('1')], {
            as: 'viewer',
          });

          expect(response.status).toBe(403);
          expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' });
        });

        it('offers the append HAL-FORMS template only to principals allowed to append', async () => {
          const { request, append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const asViewer = (await (
            await request(`${apiRoot}/streams/order%3A1`, {
              as: 'viewer',
              headers: { accept: MediaTypes.HALForms },
            })
          ).json()) as Json;
          const asEditor = (await (
            await request(`${apiRoot}/streams/order%3A1`, {
              as: 'editor',
              headers: { accept: MediaTypes.HALForms },
            })
          ).json()) as Json;

          expect(asViewer._templates).toBeUndefined();
          expect(asEditor._templates.append).toMatchObject({
            method: 'POST',
            target: `${apiRoot}/streams/order%3A1/messages`,
            contentType: 'application/json',
          });
        });

        it('does not offer the append template in plain HAL', async () => {
          const { request, append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const body = (await (
            await request(`${apiRoot}/streams/order%3A1`, {
              headers: { accept: MediaTypes.HAL },
            })
          ).json()) as Json;

          expect(body._templates).toBeUndefined();
        });
      });

      describe('append', () => {
        it('creates a stream returning 201, ETag, Location and the result', async () => {
          const { append } = await start();

          const response = await append('order:order-123', [
            orderPlaced('order-123'),
            { kind: 'Event', type: 'OrderPaid', data: { amount: 10 } },
          ]);

          expect(response.status).toBe(201);
          expect(response.headers.get('etag')).toBe('"2"');
          expect(response.headers.get('location')).toBe(
            `${apiRoot}/streams/order%3Aorder-123`,
          );
          // lastEventGlobalPosition is backend-specific and omitted when not provided
          expect(await response.json()).toMatchObject({
            streamName: 'order:order-123',
            nextExpectedStreamVersion: '2',
            createdNewStream: true,
          });
        });

        it('returns 200 when appending to an existing stream', async () => {
          const { append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const response = await append('order:1', [orderPlaced('1')]);

          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBe('"2"');
          expect(await response.json()).toMatchObject({
            createdNewStream: false,
          });
        });

        it('links to the stream and its messages in HAL', async () => {
          const { append } = await start();

          const response = await append('order:1', [orderPlaced('1')], {
            headers: { accept: MediaTypes.HAL },
          });

          const { _links } = (await response.json()) as Json;
          expect(_links.self.href).toBe(`${apiRoot}/streams/order%3A1`);
          expect(_links['emmett:messages'].href).toBe(
            `${apiRoot}/streams/order%3A1/messages`,
          );
        });

        it.each([
          ['exact version', { 'if-match': '"1"' }, 200],
          ['stream exists', { 'if-match': '*' }, 200],
          ['no concurrency check', {}, 200],
        ])(
          'accepts the %s expectation when it matches',
          async (_, headers, status) => {
            const { append } = await start();
            await append('order:1', [orderPlaced('1')]);

            const response = await append('order:1', [orderPlaced('1')], {
              headers,
            });

            expect(response.status).toBe(status);
          },
        );

        it('accepts the stream-does-not-exist expectation for a new stream', async () => {
          const { append } = await start();

          const response = await append('order:new', [orderPlaced('1')], {
            headers: { 'if-none-match': '*' },
          });

          expect(response.status).toBe(201);
        });

        it.each([
          ['exact version', 'order:1', { 'if-match': '"7"' }],
          ['stream exists', 'order:missing', { 'if-match': '*' }],
          ['stream does not exist', 'order:1', { 'if-none-match': '*' }],
        ])(
          'returns 412 when the %s expectation fails',
          async (_, streamName, headers) => {
            const { append } = await start();
            await append('order:1', [orderPlaced('1')]);

            const response = await append(streamName, [orderPlaced('1')], {
              headers,
            });

            expect(response.status).toBe(412);
            expect(await response.json()).toMatchObject({
              code: 'EXPECTED_STREAM_VERSION_MISMATCH',
              type: 'https://docs.emmett.dev/problems/expected-stream-version-mismatch',
            });
          },
        );

        it('includes the current ETag in 412 responses', async () => {
          const { append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const response = await append('order:1', [orderPlaced('1')], {
            headers: { 'if-match': '"7"' },
          });

          expect(response.headers.get('etag')).toBe('"1"');
        });

        it.each([
          ['weak ETag', { 'if-match': 'W/"1"' }],
          ['list of ETags', { 'if-match': '"1", "2"' }],
          ['malformed version', { 'if-match': '"one"' }],
          [
            'contradictory headers',
            { 'if-match': '"1"', 'if-none-match': '*' },
          ],
        ])('returns 400 for a %s', async (_, headers) => {
          const { append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const response = await append('order:1', [orderPlaced('1')], {
            headers,
          });

          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            code: 'INVALID_CONDITIONAL_HEADER',
          });
        });

        it.each([
          ['no messages', { messages: [] }],
          ['missing type', { messages: [{ data: {} }] }],
          ['empty type', { messages: [{ type: '', data: {} }] }],
          ['non-object data', { messages: [{ type: 'A', data: [1] }] }],
          [
            'unknown kind',
            { messages: [{ kind: 'Query', type: 'A', data: {} }] },
          ],
        ])('returns 400 for %s', async (_, body) => {
          const { request } = await start();

          const response = await request(
            `${apiRoot}/streams/order%3A1/messages`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
          );

          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            code: 'INVALID_REQUEST',
          });
        });

        it('returns 413 when the batch exceeds the configured limit', async () => {
          const { append } = await start({ limits: { maxAppendBatchSize: 2 } });

          const response = await append('order:1', [
            orderPlaced('1'),
            orderPlaced('2'),
            orderPlaced('3'),
          ]);

          expect(response.status).toBe(413);
          expect(await response.json()).toMatchObject({
            code: 'CONTENT_TOO_LARGE',
          });
        });

        it('returns 415 for a non-JSON body', async () => {
          const { request } = await start();

          const response = await request(
            `${apiRoot}/streams/order%3A1/messages`,
            {
              method: 'POST',
              headers: { 'content-type': 'text/plain' },
              body: 'hello',
            },
          );

          expect(response.status).toBe(415);
          expect(await response.json()).toMatchObject({
            code: 'UNSUPPORTED_MEDIA_TYPE',
          });
        });

        it('keeps the message kind and user metadata while assigning recording metadata', async () => {
          const { append, request } = await start();
          await append('order:1', [
            orderPlaced('1', {
              metadata: { tenantId: 'tenant-123', streamPosition: 99 },
            }),
            { kind: 'Command', type: 'ShipOrder', data: { orderId: '1' } },
          ]);

          const { messages } = (await (
            await request(`${apiRoot}/streams/order%3A1/messages`)
          ).json()) as Json;

          expect(messages[0]).toMatchObject({
            kind: 'Event',
            type: 'OrderPlaced',
            data: { orderId: '1' },
            metadata: {
              tenantId: 'tenant-123',
              streamName: 'order:1',
              streamPosition: '1',
              globalPosition: '1',
              checkpoint: '1',
            },
          });
          expect(typeof messages[0].metadata.messageId).toBe('string');
          expect(messages[1]).toMatchObject({
            kind: 'Command',
            type: 'ShipOrder',
          });
        });
      });

      describe('stream resource', () => {
        it('returns metadata, strong ETag and structured identity', async () => {
          const { request, append } = await start();
          await append('order:order-123', [orderPlaced('1'), orderPlaced('2')]);

          const response = await request(
            `${apiRoot}/streams/order%3Aorder-123`,
          );

          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBe('"2"');
          expect(await response.json()).toEqual({
            streamName: 'order:order-123',
            currentStreamVersion: '2',
            identity: { streamType: 'order', streamId: 'order-123' },
          });
        });

        it('omits identity for unstructured names', async () => {
          const { request, append } = await start();
          await append('plain', [orderPlaced('1')]);

          const body = (await (
            await request(`${apiRoot}/streams/plain`)
          ).json()) as Json;

          expect(body.identity).toBeUndefined();
        });

        it('links to its messages, collection and parent in HAL', async () => {
          const { request, append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const { _links, _embedded } = (await (
            await request(`${apiRoot}/streams/order%3A1`, {
              headers: { accept: MediaTypes.HAL },
            })
          ).json()) as Json;

          expect(_embedded).toBeUndefined();
          expect(_links.self.href).toBe(`${apiRoot}/streams/order%3A1`);
          expect(_links.collection.href).toBe(`${apiRoot}/streams`);
          expect(_links.up.href).toBe(apiRoot);
          expect(_links['emmett:messages']).toMatchObject({
            href: `${apiRoot}/streams/order%3A1/messages{?from,to,limit}`,
            templated: true,
          });
        });

        it('returns 404 Problem Details for a missing stream', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/streams/order%3Amissing`);

          expect(response.status).toBe(404);
          expect(await response.json()).toMatchObject({
            code: 'STREAM_NOT_FOUND',
            instance: `${apiRoot}/streams/order%3Amissing`,
          });
        });

        it('answers HEAD with 200 and ETag for an existing stream', async () => {
          const { request, append } = await start();
          await append('order:1', [orderPlaced('1')]);

          const response = await request(`${apiRoot}/streams/order%3A1`, {
            method: 'HEAD',
          });

          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBe('"1"');
          expect(await response.text()).toBe('');
        });

        it('answers HEAD with 404 for a missing stream', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/streams/missing`, {
            method: 'HEAD',
          });

          expect(response.status).toBe(404);
        });

        it.each([
          'order:order-123',
          'a/b',
          'with space & ? # %',
          'zażółć:gęślą',
        ])('round-trips the opaque stream name %s', async (streamName) => {
          const { request, append } = await start();
          expect((await append(streamName, [orderPlaced('1')])).status).toBe(
            201,
          );

          const response = await request(
            `${apiRoot}/streams/${encodeURIComponent(streamName)}`,
          );

          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ streamName });
        });
      });

      describe('reading messages', () => {
        it('returns a page with the stream ETag', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 3);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages`,
          );

          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBe('"3"');
          const body = (await response.json()) as Json;
          expect(body.streamName).toBe('cart:1');
          expect(body.currentStreamVersion).toBe('3');
          expect(body.messages.map((m: Json) => m.data.index)).toEqual([
            1, 2, 3,
          ]);
          expect(body.nextFrom).toBeUndefined();
        });

        it('pages forward without skipping or repeating messages', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 7);

          const seen: number[] = [];
          let from: string | undefined = undefined;
          let pages = 0;
          do {
            const body = (await (
              await request(
                `${apiRoot}/streams/cart%3A1/messages?limit=3${from ? `&from=${from}` : ''}`,
              )
            ).json()) as Json;
            seen.push(
              ...body.messages.map((m: Json) => m.data.index as number),
            );
            from = body.nextFrom as string | undefined;
            pages++;
          } while (from !== undefined && pages < 10);

          expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
          expect(pages).toBe(3);
        });

        it('follows HAL next links through the whole stream', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 5);

          const seen: number[] = [];
          let href: string | undefined =
            `${apiRoot}/streams/cart%3A1/messages?limit=2`;
          while (href) {
            const body = (await (
              await request(href, { headers: { accept: MediaTypes.HAL } })
            ).json()) as Json;
            seen.push(
              ...body._embedded.messages.map(
                (m: Json) => m.data.index as number,
              ),
            );
            expect(body._links.first.href).toBe(
              `${apiRoot}/streams/cart%3A1/messages?limit=2`,
            );
            expect(body._links['emmett:stream'].href).toBe(
              `${apiRoot}/streams/cart%3A1`,
            );
            href = body._links.next?.href as string | undefined;
          }

          expect(seen).toEqual([1, 2, 3, 4, 5]);
        });

        it('honours inclusive from and to bounds', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 6);

          const body = (await (
            await request(`${apiRoot}/streams/cart%3A1/messages?from=2&to=4`)
          ).json()) as Json;

          expect(
            body.messages.map((m: Json) => m.metadata.streamPosition),
          ).toEqual(['2', '3', '4']);
          expect(body.nextFrom).toBeUndefined();
        });

        it('returns the same messages in JSON and HAL', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 3);

          const json = (await (
            await request(`${apiRoot}/streams/cart%3A1/messages`)
          ).json()) as Json;
          const hal = (await (
            await request(`${apiRoot}/streams/cart%3A1/messages`, {
              headers: { accept: MediaTypes.HAL },
            })
          ).json()) as Json;

          expect(
            hal._embedded.messages.map(({ _links, ...message }: Json) => {
              expect(_links.up.href).toBe(`${apiRoot}/streams/cart%3A1`);
              return message;
            }),
          ).toEqual(json.messages);
          expect(hal.messages).toBeUndefined();
        });

        it.each([
          ['a negative from', 'from=-1'],
          ['a non-numeric to', 'to=abc'],
          ['to lower than from', 'from=5&to=2'],
          ['a zero limit', 'limit=0'],
        ])('returns 400 for %s', async (_, query) => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 1);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages?${query}`,
          );

          expect(response.status).toBe(400);
          expect(response.headers.get('content-type')).toContain(
            MediaTypes.Problem,
          );
        });

        it('returns 404 instead of an empty collection for a missing stream', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/streams/missing/messages`);

          expect(response.status).toBe(404);
        });

        it('returns 304 when If-None-Match matches the current ETag', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 2);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages`,
            {
              headers: { 'if-none-match': '"2"' },
            },
          );

          expect(response.status).toBe(304);
          expect(response.headers.get('etag')).toBe('"2"');
        });

        it('returns 406 for an unsupported representation', async () => {
          const { request, append } = await start();
          await appendMany(append, 'cart:1', 1);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages`,
            {
              headers: { accept: 'text/csv' },
            },
          );

          expect(response.status).toBe(406);
          expect(await response.json()).toMatchObject({
            code: 'NOT_ACCEPTABLE',
          });
        });
      });

      describe('finite streaming', () => {
        it('streams the whole range as an RFC 7464 JSON text sequence', async () => {
          const { request, append } = await start({
            limits: { streamingPageSize: 2 },
          });
          await appendMany(append, 'cart:1', 5);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages`,
            {
              headers: { accept: MediaTypes.JSONSequence },
            },
          );

          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toContain(
            MediaTypes.JSONSequence,
          );
          expect(response.headers.get('etag')).toBe('"5"');
          const records = (await readSequence(response)) as Json[];
          expect(records.map((m) => m.data.index)).toEqual([1, 2, 3, 4, 5]);
          expect(records[0]!.metadata.streamPosition).toBe('1');
        });

        it('honours from, to and limit', async () => {
          const { request, append } = await start({
            limits: { streamingPageSize: 2 },
          });
          await appendMany(append, 'cart:1', 10);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages?from=3&to=9&limit=4`,
            { headers: { accept: MediaTypes.JSONSequence } },
          );

          const records = (await readSequence(response)) as Json[];
          expect(records.map((m) => m.data.index)).toEqual([3, 4, 5, 6]);
        });

        it('is not capped by the JSON page size limit', async () => {
          const { request, append } = await start({
            limits: { maxPageSize: 2, streamingPageSize: 2 },
          });
          await appendMany(append, 'cart:1', 5);

          const response = await request(
            `${apiRoot}/streams/cart%3A1/messages`,
            {
              headers: { accept: MediaTypes.JSONSequence },
            },
          );

          expect(await readSequence(response)).toHaveLength(5);
        });

        it('stops reading from the backend when the client cancels', async () => {
          const store = getInMemoryEventStore();
          let backendReads = 0;
          const eventStore: EventStore = {
            ...store,
            readStream: (...args) => {
              backendReads++;
              return store.readStream(...args);
            },
          };
          await store.appendToStream(
            'big',
            Array.from({ length: 20_000 }, (_, index) => ({
              type: 'ItemAdded',
              data: { index, payload: 'x'.repeat(100) },
            })),
          );
          const { request } = await start({
            eventStore,
            limits: { streamingPageSize: 10 },
          });
          const abortController = new AbortController();

          const response = await request(`${apiRoot}/streams/big/messages`, {
            headers: { accept: MediaTypes.JSONSequence },
            signal: abortController.signal,
          });
          const reader = response.body!.getReader();
          await reader.read();
          abortController.abort();
          await reader.cancel().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 200));
          const readsAfterCancel = backendReads;
          await new Promise((resolve) => setTimeout(resolve, 200));

          expect(backendReads).toBe(readsAfterCancel);
          expect(backendReads).toBeLessThan(2_000);
        });
      });

      describe('stream catalog', () => {
        it('lists streams with versions and identities', async () => {
          const { request, append } = await start();
          await append('order:2', [orderPlaced('2')]);
          await append('order:1', [orderPlaced('1'), orderPlaced('1')]);

          const body = (await (
            await request(`${apiRoot}/streams`)
          ).json()) as Json;

          expect(body).toEqual({
            streams: [
              {
                streamName: 'order:1',
                currentStreamVersion: '2',
                identity: { streamType: 'order', streamId: '1' },
              },
              {
                streamName: 'order:2',
                currentStreamVersion: '1',
                identity: { streamType: 'order', streamId: '2' },
              },
            ],
          });
        });

        it('pages deterministically with an opaque cursor', async () => {
          const { request, append } = await start();
          for (const id of ['c', 'a', 'e', 'b', 'd'])
            await append(`s:${id}`, [orderPlaced(id)]);

          const names: string[] = [];
          let cursor: string | undefined;
          do {
            const body = (await (
              await request(
                `${apiRoot}/streams?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
              )
            ).json()) as Json;
            names.push(
              ...body.streams.map((s: Json) => s.streamName as string),
            );
            cursor = body.nextCursor as string | undefined;
          } while (cursor);

          expect(names).toEqual(['s:a', 's:b', 's:c', 's:d', 's:e']);
        });

        it('embeds streams and links pages in HAL', async () => {
          const { request, append } = await start();
          for (const id of ['a', 'b', 'c'])
            await append(`s:${id}`, [orderPlaced(id)]);

          const body = (await (
            await request(`${apiRoot}/streams?limit=2`, {
              headers: { accept: MediaTypes.HAL },
            })
          ).json()) as Json;

          expect(body._embedded.streams).toHaveLength(2);
          expect(
            body._embedded.streams[0]._links['emmett:messages'].templated,
          ).toBe(true);
          expect(body._links.first.href).toBe(`${apiRoot}/streams?limit=2`);
          expect(body._links.next.href).toMatch(
            new RegExp(`^${apiRoot}/streams\\?limit=2&cursor=`),
          );
          expect(body._links['emmett:find']).toMatchObject({
            href: `${apiRoot}/streams{?q,streamType,limit}`,
            templated: true,
          });
          expect(body._links.up.href).toBe(apiRoot);
        });

        it('filters by search text and structured stream type', async () => {
          const { request, append } = await start();
          await append('order:1', [orderPlaced('1')]);
          await append('cart:1', [orderPlaced('1')]);
          await append('cart:order', [orderPlaced('1')]);

          const bySearch = (await (
            await request(`${apiRoot}/streams?q=ORDER`)
          ).json()) as Json;
          const byType = (await (
            await request(`${apiRoot}/streams?streamType=cart`)
          ).json()) as Json;

          expect(bySearch.streams.map((s: Json) => s.streamName)).toEqual([
            'cart:order',
            'order:1',
          ]);
          expect(byType.streams.map((s: Json) => s.streamName)).toEqual([
            'cart:1',
            'cart:order',
          ]);
        });

        it('returns 400 for an invalid cursor', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/streams?cursor=%%%`);

          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            code: 'INVALID_CURSOR',
          });
        });

        it('returns 501 when the backend has no catalog', async () => {
          const { request } = await start({ withoutCatalog: true });

          const response = await request(`${apiRoot}/streams`);

          expect(response.status).toBe(501);
          expect(await response.json()).toMatchObject({
            code: 'NOT_IMPLEMENTED',
          });
        });
      });

      describe('documentation', () => {
        it('serves the OpenAPI document rebased to the effective API root', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/openapi.json`);

          expect(response.status).toBe(200);
          const document = (await response.json()) as Json;
          expect(document.openapi).toBe('3.1.0');
          expect(Object.keys(document.paths)).toContain(
            `${apiRoot}/streams/{streamName}/messages`,
          );
        });

        it('serves human-readable documentation', async () => {
          const { request } = await start();

          const response = await request(`${apiRoot}/docs`);

          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toContain('text/html');
          expect(await response.text()).toContain(`${apiRoot}/openapi.json`);
        });

        it('does not mount documentation routes when disabled', async () => {
          const { request } = await start({
            documentation: { enabled: false },
          });

          const root = (await (
            await request(apiRoot, { headers: { accept: MediaTypes.HAL } })
          ).json()) as Json;
          const response = await request(`${apiRoot}/openapi.json`);

          expect(response.status).toBe(404);
          expect(root._links['service-desc']).toBeUndefined();
        });

        it('serves documentation without credentials when public', async () => {
          const { request } = await start({ documentation: { public: true } });

          const docs = await request(`${apiRoot}/openapi.json`, {
            as: 'anonymous',
          });
          const data = await request(`${apiRoot}/streams`, { as: 'anonymous' });

          expect(docs.status).toBe(200);
          expect(data.status).toBe(401);
        });
      });
    },
  );
