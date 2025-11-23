import { isNumber } from '@event-driven-io/emmett';
import { ProblemDocument } from 'http-problem-details';
import { Hono } from 'hono';

export const problemDetailsMiddleware = (mapError?: ErrorToProblemDetailsMapping) => {
  return async (context: Context, next: Next) => {