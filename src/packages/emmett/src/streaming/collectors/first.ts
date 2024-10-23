import type { ReadableStream } from 'web-streams-polyfill';
import { EmmettError } from '../../errors';

export const first = async <T>(stream: ReadableStream<T>): Promise<T> => {
  const reader = stream.getReader();

  try {
    const { value } = await reader.read();

    if (value === undefined)
      throw new EmmettError('Cannot read first item as stream was empty!');

    return value;
  } finally {
    reader.releaseLock();
  }
};

export function firstOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: NonNullable<T>,
): Promise<NonNullable<T>>;

export function firstOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: null,
): Promise<T | null>;

export function firstOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue?: T | null,
): Promise<T | null>;

export async function firstOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: T | null = null,
): Promise<T | null> {
  const reader = stream.getReader();

  try {
    const { value } = await reader.read();

    return value !== undefined && value !== null ? value : defaultValue;
  } finally {
    reader.releaseLock();
  }
}
