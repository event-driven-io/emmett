import type { DefaultRecord } from '@event-driven-io/emmett';

export interface Decoder<Source = unknown, Decoded = DefaultRecord> {
  addToBuffer(data: Source): void;
  decode(): Decoded | null;
  clearBuffer(): void;
  hasCompleteMessage(): boolean;
}

export * from './binary';
export * from './composite';
export * from './json';
export * from './object';
export * from './string';
