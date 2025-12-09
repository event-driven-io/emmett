import {
  assertEqual,
  assertFails,
  assertMatches,
  type Event,
  type EventStore,
  type TestEventStream,
  WrapEventStore,
} from '@event-driven-io/emmett';
import type { Hono } from 'hono';
import type { ProblemDocument } from 'http-problem-details';

////////////////////////////////
/////////// Setup
////////////////////////////////

// Wrapper to mimic supertest API but using Hono's fetch
export class HonoTestRequest {
  constructor(
    private app: Hono,
    private method: string,
    private path: string,
    private options: { body?: unknown; headers?: Record<string, string> } = {},
  ) {}

  send(body?: unknown): HonoTestRequest {
    this.options.body = body;
    return this;
  }

  set(headers: Record<string, string>): HonoTestRequest {
    this.options.headers = { ...this.options.headers, ...headers };
    return this;
  }

  async expect(): Promise<HonoResponse> {
    return this.execute();
  }

  async execute(): Promise<HonoResponse> {
    const { body, headers } = this.options;
    const url = `http://localhost${this.path}`;

    const requestInit: RequestInit = {
      method: this.method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (body) {
      requestInit.body = JSON.stringify(body);
    }

    const request = new Request(url, requestInit);
    const response = await this.app.fetch(request);

    return new HonoResponse(response);
  }
}

export class HonoTestAgent {
  constructor(private app: Hono) {}

  get(path: string): HonoTestRequest {
    return new HonoTestRequest(this.app, 'GET', path);
  }

  post(path: string): HonoTestRequest {
    return new HonoTestRequest(this.app, 'POST', path);
  }

  put(path: string): HonoTestRequest {
    return new HonoTestRequest(this.app, 'PUT', path);
  }

  patch(path: string): HonoTestRequest {
    return new HonoTestRequest(this.app, 'PATCH', path);
  }

  delete(path: string): HonoTestRequest {
    return new HonoTestRequest(this.app, 'DELETE', path);
  }
}

// Wrapper to mimic supertest Response API
export class HonoResponse {
  private _body: unknown = null;
  private _bodyPromise: Promise<unknown> | null = null;

  constructor(private response: Response) {}

  get statusCode(): number {
    return this.response.status;
  }

  get status(): number {
    return this.response.status;
  }

  get headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    this.response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  get body(): unknown {
    // Note: This may return null if body hasn't been parsed yet
    // Use json() method for reliable async access
    return this._body;
  }

  async json(): Promise<unknown> {
    if (this._bodyPromise === null) {
      this._bodyPromise = (async () => {
        if (this._body === null) {
          const text = await this.response.text();
          try {
            this._body = text ? JSON.parse(text) : null;
          } catch {
            this._body = text;
          }
        }
        return this._body;
      })();
    }
    return this._bodyPromise;
  }

  async text(): Promise<string> {
    return await this.response.text();
  }
}

export type TestRequest = (
  request: HonoTestAgent,
) => HonoTestRequest | Promise<HonoResponse>;

export const existingStream = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

////////////////////////////////
/////////// Asserts
////////////////////////////////

export type ResponseAssert = (
  response: HonoResponse,
) => boolean | void | Promise<boolean> | Promise<void>;

export type ApiSpecificationAssert<EventType extends Event = Event> =
  | TestEventStream<EventType>[]
  | ResponseAssert
  | [ResponseAssert, ...TestEventStream<EventType>[]];

export const expect = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

export const expectNewEvents = <EventType extends Event = Event>(
  streamId: string,
  events: EventType[],
): TestEventStream<EventType> => {
  return [streamId, events];
};

export const expectResponse =
  <Body = unknown>(
    statusCode: number,
    options?: { body?: Body; headers?: { [index: string]: string } },
  ) =>
  async (response: HonoResponse): Promise<void> => {
    const { body, headers } = options ?? {};
    assertEqual(statusCode, response.statusCode, "Response code doesn't match");
    if (body !== undefined) {
      const responseBody = await response.json();
      assertMatches(responseBody, body);
    }
    if (headers) assertMatches(response.headers, headers);
  };

export const expectError = (
  errorCode: number,
  problemDetails?: Partial<ProblemDocument>,
) =>
  expectResponse(
    errorCode,
    problemDetails ? { body: problemDetails } : undefined,
  );

////////////////////////////////
/////////// Api Specification
////////////////////////////////

export type ApiSpecification<EventType extends Event = Event> = (
  ...givenStreams: TestEventStream<EventType>[]
) => {
  when: (setupRequest: TestRequest) => {
    then: (verify: ApiSpecificationAssert<EventType>) => Promise<void>;
  };
};

export const ApiSpecification = {
  for: <EventType extends Event = Event, Store extends EventStore = EventStore>(
    getEventStore: () => Store,
    getApplication: (eventStore: Store) => Hono,
  ): ApiSpecification<EventType> => {
    {
      return (...givenStreams: TestEventStream<EventType>[]) => {
        const eventStore = WrapEventStore(getEventStore());
        const application = getApplication(eventStore);

        return {
          when: (setupRequest: TestRequest) => {
            const handle = async () => {
              for (const [streamName, events] of givenStreams) {
                await eventStore.setup(streamName, events);
              }

              const requestResult = setupRequest(
                new HonoTestAgent(application),
              );

              // If it's already a promise (HonoResponse), return it
              if (requestResult instanceof Promise) {
                return requestResult;
              }

              // Otherwise, it's a HonoTestRequest, execute it
              return requestResult.execute();
            };

            return {
              then: async (
                verify: ApiSpecificationAssert<EventType>,
              ): Promise<void> => {
                const response = await handle();

                if (typeof verify === 'function') {
                  const succeeded = await verify(response);

                  if (succeeded === false) assertFails();
                } else if (Array.isArray(verify)) {
                  const [first, ...rest] = verify;

                  if (typeof first === 'function') {
                    const succeeded = await first(response);

                    if (succeeded === false) assertFails();
                  }

                  const events = typeof first === 'function' ? rest : verify;

                  assertMatches(
                    Array.from(eventStore.appendedEvents.values()),
                    events,
                  );
                }
              },
            };
          },
        };
      };
    }
  },
};
