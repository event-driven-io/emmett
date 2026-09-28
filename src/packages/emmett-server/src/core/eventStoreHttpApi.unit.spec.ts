import {
  getInMemoryEventStore,
  type EventStore,
  type PortableApi,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { describe, expect, it } from 'vitest';
import {
  MediaTypes,
  schemaRef,
  validateAgainstSchema,
  type Principal,
  type SchemaName,
} from '../contract';
import type { AuthorizationRequest } from './authorization';
import {
  eventStoreHttpApi,
  type EventStoreHttpApiOptions,
  type OperationTelemetry,
} from './eventStoreHttpApi';
import { inMemoryStreamCatalog } from './streamCatalog';

const admin: Principal = {
  id: 'admin-1',
  authenticationMethod: 'test',
  roles: ['admin'],
};

const setup = (options?: Partial<EventStoreHttpApiOptions>) => {
  const catalog = inMemoryStreamCatalog();
  const eventStore =
    options?.eventStore ??
    getInMemoryEventStore({ hooks: { onAfterCommit: catalog.onAfterCommit } });

  const api = eventStoreHttpApi({
    eventStore,
    authentication: () => admin,
    backend: { streamCatalog: catalog },
    ...options,
  });

  return { api, eventStore, invoke: invoker(api) };
};

const invoker =
  (api: PortableApi) =>
  (
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: unknown },
  ): Promise<Response> => {
    const url = new URL(path, 'http://localhost');
    const relative = url.pathname.replace(/^\/v1/, '');

    for (const route of api.routes) {
      if (route.method !== method) continue;

      const names: string[] = [];
      const pattern = new RegExp(
        `^${route.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
          names.push(name);
          return '([^/]+)';
        })}$`,
      );
      const match = pattern.exec(relative);
      if (!match) continue;

      return route.handler({
        method,
        url,
        apiRoot: '/v1',
        params: Object.fromEntries(
          names.map((name, index) => [
            name,
            decodeURIComponent(match[index + 1]!),
          ]),
        ),
        headers: new Headers(init?.headers),
        body:
          init?.body !== undefined
            ? new Response(JSON.stringify(init.body)).body
            : null,
        signal: new AbortController().signal,
        context: undefined,
      });
    }

    throw new Error(`No route for ${method} ${path}`);
  };

const appendOrder = (
  invoke: ReturnType<typeof invoker>,
  streamName = 'order:1',
) =>
  invoke('POST', `/v1/streams/${encodeURIComponent(streamName)}/messages`, {
    headers: { 'content-type': 'application/json' },
    body: {
      messages: [{ type: 'OrderPlaced', data: { orderId: '1', total: 10 } }],
    },
  });

const expectValid = async (response: Response, schema: SchemaName) => {
  const body = await response.json();
  expect(validateAgainstSchema(body, schemaRef(schema))).toEqual([]);
};

void describe('eventStoreHttpApi', () => {
  void describe('representations match the contract schemas', () => {
    void it('API root', async () => {
      const { invoke } = setup();

      await expectValid(await invoke('GET', '/v1'), 'ApiRoot');
    });

    void it('append result, stream, message page and catalog page', async () => {
      const { invoke } = setup();

      await expectValid(await appendOrder(invoke), 'AppendResult');
      await expectValid(await invoke('GET', '/v1/streams/order%3A1'), 'Stream');
      await expectValid(
        await invoke('GET', '/v1/streams/order%3A1/messages'),
        'MessagePage',
      );
      await expectValid(
        await invoke('GET', '/v1/streams/order%3A1/messages', {
          headers: { accept: MediaTypes.HAL },
        }),
        'MessagePageHal',
      );
      await expectValid(
        await invoke('GET', '/v1/streams'),
        'StreamCatalogPage',
      );
      await expectValid(
        await invoke('GET', '/v1/streams', {
          headers: { accept: MediaTypes.HAL },
        }),
        'StreamCatalogPageHal',
      );
    });

    void it('problem details', async () => {
      const { invoke } = setup();

      await expectValid(
        await invoke('GET', '/v1/streams/missing'),
        'ProblemDetails',
      );
    });
  });

  void describe('backend-specific values', () => {
    void it('returns the last global position as a decimal string when the backend provides it', async () => {
      const store = getInMemoryEventStore();
      const eventStore: EventStore = {
        ...store,
        appendToStream: async (...args) => ({
          ...(await store.appendToStream(...args)),
          lastEventGlobalPosition: '0000000000000009877',
        }),
      };
      const { invoke } = setup({ eventStore });

      const response = await appendOrder(invoke);

      expect(await response.json()).toMatchObject({
        lastEventGlobalPosition: '9877',
      });
    });

    void it('pages correctly on backends with zero-based positions and windowed versions', async () => {
      const messages = Array.from({ length: 5 }, (_, index) => ({
        kind: 'Event' as const,
        type: 'ItemAdded',
        data: { index },
        metadata: {
          messageId: `${index}`,
          streamName: 's',
          streamPosition: BigInt(index),
        },
      })) as ReadEvent[];
      const eventStore: EventStore = {
        ...getInMemoryEventStore(),
        // Emulates a backend where `from` is an inclusive zero-based position
        // and the reported version is the last returned message.
        readStream: (_, options) => {
          const events = messages.filter(
            (m) =>
              m.metadata.streamPosition >= (options?.from ?? 0n) &&
              (options?.to === undefined ||
                m.metadata.streamPosition <= options.to),
          );
          return Promise.resolve({
            events: events as never,
            currentStreamVersion: events.at(-1)?.metadata.streamPosition ?? 0n,
            streamExists: events.length > 0,
          });
        },
      };
      const { invoke } = setup({
        eventStore,
        backend: {
          readStreamVersion: () =>
            Promise.resolve({ streamExists: true, currentStreamVersion: 4n }),
        },
      });

      const seen: number[] = [];
      let from: string | undefined;
      do {
        const body = (await (
          await invoke(
            'GET',
            `/v1/streams/s/messages?limit=2${from !== undefined ? `&from=${from}` : ''}`,
          )
        ).json()) as {
          messages: { data: { index: number } }[];
          nextFrom?: string;
        };
        seen.push(...body.messages.map((m) => m.data.index));
        from = body.nextFrom;
      } while (from !== undefined);

      expect(seen).toEqual([0, 1, 2, 3, 4]);
    });

    void it('serializes bigint values in message data as decimal strings', async () => {
      const { invoke, eventStore } = setup();
      await eventStore.appendToStream('s', [
        { type: 'Paid', data: { amount: 12345678901234567890n } },
      ]);

      const body = (await (
        await invoke('GET', '/v1/streams/s/messages')
      ).json()) as { messages: { data: { amount: string } }[] };

      expect(body.messages[0]!.data.amount).toBe('12345678901234567890');
    });
  });

  void describe('authorization', () => {
    void it('passes stream, identity, message types and deployment to the policy', async () => {
      const requests: AuthorizationRequest[] = [];
      const { invoke } = setup({
        deployment: { tenant: 'acme' },
        authorize: (request) => {
          requests.push(request);
          return true;
        },
      });

      await appendOrder(invoke, 'order:1');

      expect(requests.at(-1)).toEqual({
        principal: admin,
        operation: 'appendMessages',
        permission: 'streams:append',
        streamName: 'order:1',
        streamIdentity: { streamType: 'order', streamId: '1' },
        messageTypes: ['OrderPlaced'],
        deployment: { tenant: 'acme' },
      });
    });

    void it('rejects messages types the policy forbids', async () => {
      const { invoke } = setup({
        authorize: ({ messageTypes }) => !messageTypes?.includes('OrderPlaced'),
      });

      const response = await appendOrder(invoke);

      expect(response.status).toBe(403);
    });
  });

  void describe('errors and telemetry', () => {
    void it('hides unexpected errors behind a generic 500 and reports them', async () => {
      const reported: unknown[] = [];
      const store = getInMemoryEventStore();
      const { invoke } = setup({
        eventStore: {
          ...store,
          readStream: () =>
            Promise.reject(new Error('connection to db-secret:5432 failed')),
        },
        observability: { onError: (error) => reported.push(error) },
      });

      const response = await invoke('GET', '/v1/streams/s');
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).not.toContain('db-secret');
      expect(JSON.parse(text)).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(reported).toHaveLength(1);
    });

    void it('uses the W3C trace id in problems and telemetry', async () => {
      const telemetry: OperationTelemetry[] = [];
      const { invoke } = setup({
        observability: { onOperationCompleted: (t) => telemetry.push(t) },
      });

      const response = await invoke('GET', '/v1/streams/order%3Amissing', {
        headers: {
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      });

      expect(await response.json()).toMatchObject({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      });
      expect(telemetry).toEqual([
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          operation: 'getStream',
          outcome: 'failure',
          status: 404,
          durationMs: expect.any(Number) as number,
          principalId: 'admin-1',
          authenticationMethod: 'test',
          streamType: 'order',
          errorCode: 'STREAM_NOT_FOUND',
        },
      ]);
    });

    void it('includes stream names in telemetry only when enabled', async () => {
      const telemetry: OperationTelemetry[] = [];
      const { invoke } = setup({
        observability: {
          includeStreamNames: true,
          onOperationCompleted: (t) => telemetry.push(t),
        },
      });

      await appendOrder(invoke);

      expect(telemetry[0]).toMatchObject({
        operation: 'appendMessages',
        outcome: 'success',
        status: 201,
        streamName: 'order:1',
      });
    });

    void it('rejects bodies over the configured size', async () => {
      const { invoke } = setup({ limits: { maxBodyBytes: 10 } });

      const response = await appendOrder(invoke);

      expect(response.status).toBe(413);
    });
  });
});
