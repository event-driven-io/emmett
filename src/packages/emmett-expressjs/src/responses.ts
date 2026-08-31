import {
  StreamETags,
  isExpectedVersionConflictError,
} from '@event-driven-io/emmett';
import type { Request, Response } from 'express';
import { ProblemDocument } from 'http-problem-details';
import { HeaderNames, setETag, type ETag } from './etag';

export type ErrorToProblemDetailsMapping = (
  error: unknown,
  request: Request,
) => ProblemDocument | undefined;

export type HttpResponseOptions = {
  body?: unknown;
  location?: string;
  eTag?: ETag;
};
export const DefaultHttpResponseOptions: HttpResponseOptions = {};

export type HttpProblemResponseOptions = {
  location?: string;
  eTag?: ETag;
  error?: unknown;
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
  response: Response,
  { eTag, ...options }: CreatedHttpResponseOptions,
): void =>
  send(response, 201, {
    location:
      'url' in options
        ? options.url
        : `${response.req.url}/${options.createdId}`,
    body:
      'createdId' in options
        ? { id: options.createdId, ...(options.body ?? {}) }
        : options.body,
    eTag,
  });

export type AcceptedHttpResponseOptions = {
  location: string;
} & HttpResponseOptions;

export const sendAccepted = (
  response: Response,
  options: AcceptedHttpResponseOptions,
): void => send(response, 202, options);

export type NoContentHttpResponseOptions = Omit<HttpResponseOptions, 'body'>;

export const sendNoContent = (
  response: Response,
  options?: NoContentHttpResponseOptions,
): void => send(response, 204, options);

export const send = (
  response: Response,
  statusCode: number,
  options?: HttpResponseOptions,
): void => {
  const { location, body, eTag } = options ?? DefaultHttpResponseOptions;
  // HEADERS
  if (eTag) setETag(response, eTag);
  if (location) response.setHeader('Location', location);

  if (body) {
    response.statusCode = statusCode;
    response.send(body);
  } else {
    response.sendStatus(statusCode);
  }
};

const currentVersionETag = ({
  error,
}: HttpProblemResponseOptions): ETag | undefined =>
  isExpectedVersionConflictError(error) &&
  error.streamName !== undefined &&
  error.current !== undefined
    ? StreamETags.from(error.streamName, error.current)
    : undefined;

export const sendProblem = (
  response: Response,
  statusCode: number,
  options?: HttpProblemResponseOptions,
): void => {
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
  const problemETag = eTag ?? currentVersionETag(options);

  if (problemETag) setETag(response, problemETag);
  else response.removeHeader(HeaderNames.ETag);

  if (location) response.setHeader('Location', location);

  response.setHeader('Content-Type', 'application/problem+json');

  response.statusCode = statusCode;

  // `response.json` hashes the body into the `ETag` header of a response that carries none, and
  // that hash is not the validator of the target resource, so the document is written here.
  const body = JSON.stringify(problemDetails);
  response.setHeader('Content-Length', Buffer.byteLength(body).toString());
  response.end(body);
};

export type EventResponseSource<Event> = Event[] | { events: Event[] };

type EventOf<Source> = Source extends (infer Event)[]
  ? Event
  : Source extends { events: (infer Event)[] }
    ? Event
    : never;

type MappedHttpResponse = (response: Response) => void;

export type EventSuccessResponse = number | MappedHttpResponse;

export type EventFailureResponse = number | MappedHttpResponse;

export type ResponseFromEventsOptions<
  Source extends EventResponseSource<unknown>,
> = {
  events: Source;
  success?: number | ((source: Source) => EventSuccessResponse);
  failure?: (
    event: EventOf<Source>,
    source: Source,
  ) => EventFailureResponse | undefined;
};

export const ResponseFromEvents = <
  Source extends EventResponseSource<unknown>,
>({
  events: source,
  success = 204,
  failure,
}: ResponseFromEventsOptions<Source>): MappedHttpResponse => {
  const events = (
    Array.isArray(source) ? source : source.events
  ) as EventOf<Source>[];

  if (failure) {
    for (let index = events.length - 1; index >= 0; index--) {
      const selected = failure(events[index]!, source);
      if (selected === undefined) continue;
      return typeof selected === 'number'
        ? (response) => sendProblem(response, selected)
        : selected;
    }
  }

  const selected = typeof success === 'number' ? success : success(source);
  return typeof selected === 'number'
    ? (response) => send(response, selected)
    : selected;
};

export const sendResponseFromEvents = <
  Source extends EventResponseSource<unknown>,
>(
  response: Response,
  options: ResponseFromEventsOptions<Source>,
): void => ResponseFromEvents(options)(response);
