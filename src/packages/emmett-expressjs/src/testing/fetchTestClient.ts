export type Fetch = (request: Request) => Response | Promise<Response>;

export type FetchTestResponse = Readonly<{
  status: number;
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}>;

export type FetchResponseAssert = (
  response: FetchTestResponse,
) => boolean | void | Promise<boolean> | Promise<void>;

export type FetchTestRequestSetup = (
  request: FetchTestAgent,
) => FetchTestRequest | Promise<FetchTestResponse>;

export type FetchTestRequest = {
  send(body?: unknown): FetchTestRequest;
  set(field: string, value: string): FetchTestRequest;
  set(headers: Record<string, string>): FetchTestRequest;
  execute(): Promise<FetchTestResponse>;
};

const fetchTestRequest = (
  fetch: Fetch,
  method: string,
  path: string,
): FetchTestRequest => {
  let body: unknown;
  let headers: Record<string, string> = {};

  const request: FetchTestRequest = {
    send: (newBody?: unknown) => {
      body = newBody;
      return request;
    },
    set: (fieldOrHeaders: string | Record<string, string>, value?: string) => {
      const newHeaders =
        typeof fieldOrHeaders === 'string'
          ? { [fieldOrHeaders]: value! }
          : fieldOrHeaders;
      headers = { ...headers, ...newHeaders };
      return request;
    },
    execute: async () => {
      const response = await fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const text = await response.text();
      let responseBody: unknown = {};

      if (text.length > 0) {
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = text;
        }
      }

      return {
        status: response.status,
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };
    },
  };

  return request;
};

export type FetchTestAgent = Readonly<{
  get(path: string): FetchTestRequest;
  post(path: string): FetchTestRequest;
  put(path: string): FetchTestRequest;
  patch(path: string): FetchTestRequest;
  delete(path: string): FetchTestRequest;
}>;

const fetchTestAgent = (fetch: Fetch): FetchTestAgent => ({
  get: (path) => fetchTestRequest(fetch, 'GET', path),
  post: (path) => fetchTestRequest(fetch, 'POST', path),
  put: (path) => fetchTestRequest(fetch, 'PUT', path),
  patch: (path) => fetchTestRequest(fetch, 'PATCH', path),
  delete: (path) => fetchTestRequest(fetch, 'DELETE', path),
});

export const executeFetchRequest = (
  fetch: (request: Request) => Response | Promise<Response>,
  setupRequest: FetchTestRequestSetup,
): Promise<FetchTestResponse> => {
  const request = setupRequest(fetchTestAgent(fetch));
  return request instanceof Promise ? request : request.execute();
};
