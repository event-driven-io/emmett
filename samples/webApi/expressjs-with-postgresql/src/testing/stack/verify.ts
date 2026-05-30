import { test } from 'node:test';
import type { Verification, Verify } from './types';

// Turns a record of named verifications into a callable namespace:
//   verify()            → registers every verification as a node:test test
//   verify.<key>()      → registers just that one, typed (unknown keys won't compile)
// The helper owns the `test(name, fn)` call so resources never import node:test.
export const verifications = <T extends Record<string, Verification>>(
  group: T,
): Verify<T> => {
  const all = async (): Promise<void> => {
    for (const v of Object.values(group)) await test(v.name, v.verify);
  };
  const named = Object.fromEntries(
    Object.entries(group).map(([k, v]) => [k, () => test(v.name, v.verify)]),
  );
  return Object.assign(all, named) as Verify<T>;
};

// Aggregates several verify runners into one, preserving declaration order.
export const aggregate =
  (...parts: Array<() => Promise<void>>): (() => Promise<void>) =>
  async (): Promise<void> => {
    for (const part of parts) await part();
  };
