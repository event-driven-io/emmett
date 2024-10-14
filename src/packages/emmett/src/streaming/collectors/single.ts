import type {
  ReadableStream,
  ReadableStreamDefaultReader,
} from 'web-streams-polyfill';
import { EmmettError } from '../../errors';

export const single = async <T>(stream: ReadableStream<T>): Promise<T> => {
  const reader = stream.getReader();

  try {
    const { done, value } = await reader.read();

    if (!value && done)
      throw new EmmettError('Cannot read first item as stream was empty!');

    if (value === undefined) throw new EmmettError('Value was undefined!');

    await assertThatThereAreNoOtherItems(reader);

    return value;
  } finally {
    reader.releaseLock();
  }
};

export function singleOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: NonNullable<T>,
): Promise<NonNullable<T>>;

export function singleOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: null,
): Promise<T | null>;

export function singleOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue?: T | null,
): Promise<T | null>;

export async function singleOrDefault<T>(
  stream: ReadableStream<T | null>,
  defaultValue: T | null = null,
): Promise<T | null> {
  const reader = stream.getReader();

  try {
    const { value, done } = await reader.read();

    if (done) return value ?? defaultValue;

    await assertThatThereAreNoOtherItems(reader);

    return value ?? defaultValue;
  } finally {
    reader.releaseLock();
  }
}

const assertThatThereAreNoOtherItems = async <T>(
  reader: ReadableStreamDefaultReader<T | null>,
) => {
  const { done: hasSingleItem, value: nextValue } = await reader.read();

  if (!hasSingleItem || nextValue) {
    throw new EmmettError(
      'Stream contained more than one item while expecting to have single!',
    );
  }
};
