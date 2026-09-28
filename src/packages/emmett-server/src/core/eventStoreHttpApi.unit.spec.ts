import {
  getInMemoryEventStore,
  type EventStore,
  type PortableApi,
  type ReadStreamOptions,
} from '@event-driven-io/emmett';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import Type from 'typebox';
import { describe, expect, it } from 'vitest';
import {
  composeEventStoreOpenApi,
  DefaultEventStoreApiSchemas,
  typeBoxSchema,
  validateWithSchema,
  type Principal,
  type SchemaName,
} from '../contract';
import type { AuthorizationRequest } from './authorization';
import {
  eventStoreHttpApi,
  type EventStoreHttpApiOptions,
  type OperationTelemetry,
} from './eventStoreHttpApi';

const admin: Principal = {
  id: 'admin-1',
  authenticationMethod: 'test',
  roles: ['admin'],
};

const setup = (options?: Partial<EventStoreHttpApiOptions>) => {
  const eventStore = options?.eventStore ?? getInMemoryEventStore();

  const api = eventStoreHttpApi({
    eventStore,
    authentication: () => admin,
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

const expectValueValid = async (value: unknown, schema: SchemaName) => {
  const contractSchema: StandardSchemaV1 = DefaultEventStoreApiSchemas[schema];
  const result = await validateWithSchema(contractSchema, value);
  expect(result.issues).toBeUndefined();
};

const expectValid = async (response: Response, schema: SchemaName) =>
  expectValueValid(await response.json(), schema);

void describe('eventStoreHttpApi', () => {
  void describe('representations match the default schemas', () => {
    void it('API root, append result, stream, messages, catalog and problems', async () => {
      const { invoke } = setup();

      await expectValid(await invoke('GET', '/v1'), 'ApiRoot');
      await expectValid(await appendOrder(invoke), 'AppendResult');
      await expectValid(await invoke('GET', '/v1/streams/order%3A1'), 'Stream');

      const page = (await (
        await invoke('GET', '/v1/streams/order%3A1/messages')
      ).json()) as { messages: unknown[] };
      for (const message of page.messages)
        await expectValueValid(message, 'RecordedMessage');

      const catalog = (await (await invoke('GET', '/v1/streams')).json()) as {
        streams: unknown[];
      };
      for (const stream of catalog.streams)
        await expectValueValid(stream, 'ListedStream');

      await expectValid(
        await invoke('GET', '/v1/streams/missing'),
        'ProblemDetails',
      );
    });
  });

  void describe('event store calls', () => {
    void it('passes from, to and limit to readStream as from, to and maxCount', async () => {
      const calls: (ReadStreamOptions | undefined)[] = [];
      const store = getInMemoryEventStore();
      await store.appendToStream('s', [{ type: 'A', data: {} }]);
      const { invoke } = setup({
        eventStore: {
          ...store,
          readStream: (streamName, options) => {
            calls.push(options as ReadStreamOptions | undefined);
            return store.readStream(streamName, options);
          },
        },
      });

      await invoke('GET', '/v1/streams/s/messages?from=2&to=9&limit=4');

      expect(calls).toEqual([{ from: 2n, to: 9n, maxCount: 4n }]);
    });

    void it('returns the append result as provided by the event store', async () => {
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

      expect(await response.json()).toEqual({
        streamName: 'order:1',
        nextExpectedStreamVersion: '1',
        createdNewStream: true,
        lastEventGlobalPosition: '0000000000000009877',
      });
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

  void describe('injected schemas', () => {
    const OrdersOnly = typeBoxSchema(
      Type.Object({
        messages: Type.Array(
          Type.Object({
            type: Type.Literal('OrderPlaced'),
            data: Type.Object({ orderId: Type.String() }),
          }),
          { minItems: 1 },
        ),
      }),
    );

    void it('validates appends with the provided schema', async () => {
      const { invoke } = setup({ schemas: { AppendRequest: OrdersOnly } });

      const rejected = await invoke('POST', '/v1/streams/s/messages', {
        headers: { 'content-type': 'application/json' },
        body: { messages: [{ type: 'CartOpened', data: {} }] },
      });
      const accepted = await appendOrder(invoke);

      expect(rejected.status).toBe(400);
      expect(accepted.status).toBe(201);
    });

    void it('describes the provided schema in the served OpenAPI document', async () => {
      const { invoke } = setup({ schemas: { AppendRequest: OrdersOnly } });

      const document = (await (
        await invoke('GET', '/v1/openapi.json')
      ).json()) as { components: { schemas: Record<string, unknown> } };

      expect(document.components.schemas.AppendRequest).toEqual(
        composeEventStoreOpenApi({ schemas: { AppendRequest: OrdersOnly } })
          .components!.schemas!.AppendRequest,
      );
      expect(document.components.schemas.AppendRequest).not.toEqual(
        composeEventStoreOpenApi().components!.schemas!.AppendRequest,
      );
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
          streamExists: () =>
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
