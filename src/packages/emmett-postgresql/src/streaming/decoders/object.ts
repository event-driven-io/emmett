import type { Decoder } from '.';

export class ObjectDecoder<Decoded> implements Decoder<Decoded, Decoded> {
  private buffer: Decoded | null = null;

  addToBuffer(data: Decoded): void {
    this.buffer = data;
  }

  clearBuffer(): void {
    this.buffer = null;
  }

  hasCompleteMessage(): boolean {
    return this.buffer !== null;
  }

  decode(): Decoded | null {
    if (!this.hasCompleteMessage() || !this.buffer) {
      return null;
    }

    const data = this.buffer;
    this.clearBuffer();
    return data as Decoded;
  }
}
