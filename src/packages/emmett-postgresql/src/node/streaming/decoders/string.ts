import type { Decoder } from '.';

export class StringDecoder<Decoded> implements Decoder<string, Decoded> {
  protected buffer: string[] = [];

  constructor(private transform: (input: string) => Decoded) {
    this.transform = transform;
  }

  addToBuffer(data: string): void {
    this.buffer.push(data);
  }

  clearBuffer(): void {
    this.buffer = [];
  }

  hasCompleteMessage(): boolean {
    return this.buffer.some((chunk) => chunk.includes('\n'));
  }

  decode(): Decoded | null {
    const completeString = this.buffer.join('');

    if (!this.hasCompleteMessage()) {
      if (completeString.trim().length > 0) {
        throw new Error('Unterminated string in JSON at position');
      }
      return null;
    }

    const delimiterIndex = completeString.indexOf('\n');
    const message = completeString.slice(0, delimiterIndex).trim();
    this.buffer = [completeString.slice(delimiterIndex + 1)];

    return this.transform(message);
  }
}
