import { describe, expect, it } from 'vitest';
import { jsonSequenceStream } from './jsonSequence';

const readAll = async (stream: ReadableStream<Uint8Array>) =>
  new Response(stream).text();

void describe('jsonSequenceStream', () => {
  void it('frames each record with a record separator and a line feed', async () => {
    async function* source() {
      yield await Promise.resolve({ id: 1 });
      yield await Promise.resolve({ id: 2 });
    }

    const text = await readAll(jsonSequenceStream(source()));

    expect(text).toBe('\u001e{"id":1}\n\u001e{"id":2}\n');
  });

  void it('pulls from the source only when the reader asks for data', async () => {
    let produced = 0;
    async function* source() {
      while (true) {
        produced++;
        yield await Promise.resolve(produced);
      }
    }

    const reader = jsonSequenceStream(source()).getReader();
    await reader.read();
    await reader.read();

    expect(produced).toBe(2);
    await reader.cancel();
  });

  void it('stops the source when the reader cancels', async () => {
    let finalized = false;
    async function* source() {
      try {
        while (true) yield await Promise.resolve(1);
      } finally {
        finalized = true;
      }
    }

    const reader = jsonSequenceStream(source()).getReader();
    await reader.read();
    await reader.cancel();

    expect(finalized).toBe(true);
  });

  void it('stops the source and closes the stream when the signal aborts', async () => {
    let finalized = false;
    async function* source() {
      try {
        while (true) yield await Promise.resolve(1);
      } finally {
        finalized = true;
      }
    }
    const abortController = new AbortController();

    const reader = jsonSequenceStream(source(), {
      signal: abortController.signal,
    }).getReader();
    await reader.read();
    abortController.abort();

    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(finalized).toBe(true);
  });
});
