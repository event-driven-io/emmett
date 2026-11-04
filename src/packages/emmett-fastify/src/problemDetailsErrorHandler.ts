import {
  defaultErrorToProblemDetailsMapping,
  type ProblemDocument,
} from '@event-driven-io/emmett';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type ErrorToProblemDetailsMapping = (
  error: unknown,
  request: FastifyRequest,
) => ProblemDocument | undefined;

export const problemDetailsErrorHandler =
  (mapError?: ErrorToProblemDetailsMapping) =>
  (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const problemDetails =
      mapError?.(error, request) ?? defaultErrorToProblemDetailsMapping(error);

    return reply
      .status(problemDetails.status)
      .header('Content-Type', 'application/problem+json')
      .send(problemDetails);
  };
