import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { ProblemDocument } from 'http-problem-details';
import { setETag, type ETag } from './etag';

export type HttpResponseOptions = {
  body?: unknown;
  location?: string;
  eTag?: ETag;
};
export const DefaultHttpResponseOptions: HttpResponseOptions = {};

export type HttpProblemResponseOptions = {
  location?: string;
  eTag?: ETag;
} & Omit<HttpResponseOptions, 'body'> &
  (
    | {
        problem: ProblemDocument;
      }
    | { problemDetails: string }
  );
export const DefaultHttpProblemResponseOptions: HttpProblemResponseOptions = {
  problemDetails: 'Error occured!',
};

export type CreatedHttpResponseOptions = (
  | {
      createdId: string;
    }
  | {
      createdId?: string;
      url: string;
    }
) &
  HttpResponseOptions;

export const sendCreated = (
  context: Context,
  { eTag, ...options }: CreatedHttpResponseOptions,
): Response => {
  return send(context, 201, {
    location:
      'url' in options
        ? options.url
        : `${context.req.url}/${options.createdId}`,
    body:
      'createdId' in options
        ? { id: options.createdId, ...(options.body ?? {}) }
        : options.body,
    eTag,
  });
};

export type AcceptedHttpResponseOptions = {
  location: string;
} & HttpResponseOptions;

export const sendAccepted = (
  context: Context,
  options: AcceptedHttpResponseOptions,
): Response => {
  return send(context, 202, options);
};

export type NoContentHttpResponseOptions = Omit<HttpResponseOptions, 'body'>;

export const sendNoContent = (
  context: Context,
  options?: NoContentHttpResponseOptions,
): Response => {
  return send(context, 204, options);
};

export const send = (
  context: Context,
  statusCode: StatusCode,
  options?: HttpResponseOptions,
): Response => {
  const { location, body, eTag } = options ?? DefaultHttpResponseOptions;
  // HEADERS
  if (eTag) setETag(context, eTag);
  if (location) context.header('Location', location);

  context.status(statusCode);

  if (body) {
    return context.json(body);
  }
  return context.body(null);
};

export const sendProblem = (
  context: Context,
  statusCode: StatusCode,
  options?: HttpProblemResponseOptions,
): Response => {
  options = options ?? DefaultHttpProblemResponseOptions;

  const { location, eTag } = options;

  const problemDetails =
    'problem' in options
      ? options.problem
      : new ProblemDocument({
          detail: options.problemDetails,
          status: statusCode,
        });

  // HEADERS
  if (eTag) setETag(context, eTag);
  if (location) context.header('Location', location);

  context.status(statusCode);

  const response = context.json(problemDetails);
  response.headers.set('Content-Type', 'application/problem+json');
  return response;
};

export type EventResponseSource<Event> = Event[] | { events: Event[] };

type EventOf<Source> = Source extends (infer Event)[]
  ? Event
  : Source extends { events: (infer Event)[] }
    ? Event
    : never;

export type EventSuccessResponse = StatusCode | Response;

export type EventFailureResponse = StatusCode | Response;

export type ResponseFromEventsOptions<
  Source extends EventResponseSource<unknown>,
> = {
  context: Context;
  events: Source;
  success?: StatusCode | ((source: Source) => EventSuccessResponse);
  failure?: (
    event: EventOf<Source>,
    source: Source,
  ) => EventFailureResponse | undefined;
};

export const ResponseFromEvents = <
  Source extends EventResponseSource<unknown>,
>({
  context,
  events: source,
  success = 204,
  failure,
}: ResponseFromEventsOptions<Source>): Response => {
  const events = (
    Array.isArray(source) ? source : source.events
  ) as EventOf<Source>[];

  if (failure) {
    for (let index = events.length - 1; index >= 0; index--) {
      const selected = failure(events[index]!, source);
      if (selected === undefined) continue;
      return typeof selected === 'number'
        ? sendProblem(context, selected)
        : selected;
    }
  }

  const selected = typeof success === 'number' ? success : success(source);
  return typeof selected === 'number' ? send(context, selected) : selected;
};

export const sendResponseFromEvents = <
  Source extends EventResponseSource<unknown>,
>(
  context: Context,
  options: Omit<ResponseFromEventsOptions<Source>, 'context'>,
): Response => ResponseFromEvents({ ...options, context });
