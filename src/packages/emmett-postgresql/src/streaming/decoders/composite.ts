import type { Decoder } from '.';
import { BinaryJsonDecoder } from './binary';
import { JsonDecoder } from './json';
import { ObjectDecoder } from './object';

export class CompositeDecoder<Decoded> implements Decoder<unknown, Decoded> {
  constructor(
    private decoders: [(data: unknown) => boolean, Decoder<unknown, Decoded>][],
  ) {}

  private decoderFor(data: unknown): Decoder<unknown, unknown> | null {
    const decoder = this.decoders.find((d) => d[0](data));

    if (!decoder) return null;

    return decoder[1];
  }

  addToBuffer(data: unknown): void {
    this.decoderFor(data)?.addToBuffer(data);
  }

  clearBuffer(): void {
    for (const decoder of this.decoders.map((d) => d[1])) {
      decoder.clearBuffer();
    }
  }

  hasCompleteMessage(): boolean {
    return this.decoders.some((d) => d[1].hasCompleteMessage());
  }

  decode(): Decoded | null {
    const decoder = this.decoders
      .map((d) => d[1])
      .find((d) => d.hasCompleteMessage());

    return decoder?.decode() ?? null;
  }
}

export class DefaultDecoder<Decoded> extends CompositeDecoder<Decoded> {
  constructor() {
    super([
      [(data) => typeof data === 'string', new JsonDecoder<Decoded>()],
      [(data) => data instanceof Uint8Array, new BinaryJsonDecoder<Decoded>()],
      [(data) => typeof data === 'object', new ObjectDecoder<Decoded>()],
    ]);
  }
}
