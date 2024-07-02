import type { ReadableStream } from '@event-driven-io/emmett-shims';
import { EmmettError } from '../../errors';
import { reduce } from '../transformations/reduce';

export const last = async <T>(stream: ReadableStream<T>): Promise<T> => {
  const tranformed = stream.pipeThrough(
    reduce<T, { last: T } | 'NOT_FOUND'>(
      (_, chunk) => ({ last: chunk }),
      'NOT_FOUND',
    ),
  );

  const reader = tranformed.getReader();

  try {
    const { value } = await reader.read();

    if (value === undefined || value === 'NOT_FOUND')
      throw new EmmettError('Cannot read last item as stream was empty!');

    if (value.last === undefined) throw new EmmettError('Value was undefined!');

    return value.last;
  } finally {
    reader.releaseLock();
  }
};

export function lastOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: NonNullable<T>,
): Promise<NonNullable<T>>;

export function lastOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: null,
): Promise<T | null>;

export function lastOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue?: T | null,
): Promise<T | null>;

export async function lastOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: T | null = null,
): Promise<T | null> {
  const tranformed = stream.pipeThrough(
    reduce<T, { last: T } | 'NOT_FOUND'>(
      (_, chunk) => ({ last: chunk }),
      'NOT_FOUND',
    ),
  );

  const reader = tranformed.getReader();

  try {
    const { value } = await reader.read();

    if (value === undefined || value === 'NOT_FOUND') return defaultValue;

    return value.last ?? defaultValue;
  } finally {
    reader.releaseLock();
  }
}
