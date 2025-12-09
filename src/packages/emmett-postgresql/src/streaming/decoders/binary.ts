import type { Decoder } from '.';
import { concatUint8Arrays } from '../binaryArrays';

export class BinaryJsonDecoder<Decoded> implements Decoder<
  Uint8Array,
  Decoded
> {
  private buffer: Uint8Array[] = [];

  addToBuffer(data: Uint8Array): void {
    this.buffer.push(data);
  }

  clearBuffer(): void {
    this.buffer = [];
  }

  hasCompleteMessage(): boolean {
    const combined = concatUint8Arrays(this.buffer);
    const text = new TextDecoder().decode(combined);
    return text.includes('\n');
  }

  decode(): Decoded | null {
    if (!this.hasCompleteMessage()) {
      return null;
    }

    const combined = concatUint8Arrays(this.buffer);
    const text = new TextDecoder().decode(combined);
    const delimiterIndex = text.indexOf('\n');

    if (delimiterIndex === -1) {
      return null;
    }

    const jsonString = text.slice(0, delimiterIndex);
    const remaining = new Uint8Array(combined.buffer, delimiterIndex + 1);
    this.buffer = remaining.byteLength > 0 ? [remaining] : [];

    return JSON.parse(jsonString) as Decoded;
  }
}
