import { test } from 'node:test';

// A named verification. Resources and the per-run mutable context are captured by the
// stack's verify factory (its two params), so the body takes no arguments and may be
// sync or async.
export type Verification = {
  name: string;
  run: () => void | PromiseLike<void>;
};

// name first; the body closes over the resources + context the factory handed it.
export const verify = (
  name: string,
  run: () => void | PromiseLike<void>,
): Verification => ({ name, run });

// Runs an array of verifications in order. Owns the test() call so specs never import
// node:test.
export const runVerifications =
  (group: Array<Verification>): (() => Promise<void>) =>
  async (): Promise<void> => {
    for (const v of group)
      await test(v.name, async () => {
        await v.run();
      });
  };

// Aggregates several verify runners into one, preserving declaration order.
export const aggregate =
  (...parts: Array<() => Promise<void>>): (() => Promise<void>) =>
  async (): Promise<void> => {
    for (const part of parts) await part();
  };
