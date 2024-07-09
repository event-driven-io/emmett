import type { DefaultRecord } from '../typing';
import { deepEquals } from '../utils';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const stringify = (obj: unknown) =>
  JSON.stringify(
    obj,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
  );

export const isSubset = (superObj: unknown, subObj: unknown): boolean => {
  const sup = superObj as DefaultRecord;
  const sub = subObj as DefaultRecord;

  assertOk(sup);
  assertOk(sub);

  return Object.keys(sub).every((ele: string) => {
    if (typeof sub[ele] == 'object') {
      return isSubset(sup[ele], sub[ele]);
    }
    return sub[ele] === sup[ele];
  });
};

export const assertFails = () => {
  throw new AssertionError('That should not ever happened, right?');
};

export const assertThrows = (
  fun: () => void,
  errorCheck?: (error: Error) => boolean,
) => {
  try {
    fun();
    throw new AssertionError("Function didn't throw expected error");
  } catch (error) {
    if (errorCheck) assertTrue(errorCheck(error as Error));
  }
};

export const assertRejects = async <T, TError extends Error = Error>(
  promise: Promise<T>,
  errorCheck?: ((error: TError) => boolean) | TError,
) => {
  try {
    await promise;
    throw new AssertionError("Function didn't throw expected error");
  } catch (error) {
    if (!errorCheck) return;

    if (errorCheck instanceof Error) assertDeepEqual(error, errorCheck);
    else assertTrue(errorCheck(error as TError));
  }
};

export const assertMatches = (
  actual: unknown,
  expected: unknown,
  message?: string,
) => {
  if (!isSubset(actual, expected))
    throw new AssertionError(
      message ??
        `subObj:\n${stringify(expected)}\nis not subset of\n${stringify(actual)}`,
    );
};

export const assertDeepEqual = (
  actual: unknown,
  expected: unknown,
  message?: string,
) => {
  if (!deepEquals(actual, expected))
    throw new AssertionError(
      message ??
        `Expected:\n${stringify(expected)}\nis not equal to\n${stringify(actual)}`,
    );
};

export const assertThat = <T>(item: T) => {
  return {
    isEqualTo: (other: T) => assertTrue(deepEquals(item, other)),
  };
};

export function assertFalse(
  condition: boolean,
  message?: string,
): asserts condition is false {
  if (condition) throw new AssertionError(message ?? `Condition is false`);
}

export function assertTrue(
  condition: boolean,
  message?: string,
): asserts condition is true {
  if (!condition) throw new AssertionError(message ?? `Condition is false`);
}

export function assertOk<T>(
  obj: T | null | undefined,
  message?: string,
): asserts obj is T {
  if (!obj) throw new AssertionError(message ?? `Condition is not truthy`);
}

export function assertEqual<T>(
  obj: T | null | undefined,
  other: T | null | undefined,
  message?: string,
): void {
  if (obj !== other)
    throw new AssertionError(
      message ??
        `Objects are not equal:\n ${stringify(obj)}\ncompared:\n${stringify(other)}`,
    );
}

export function assertNotEqual<T>(
  obj: T | null | undefined,
  other: T | null | undefined,
  message?: string,
): void {
  if (obj === other)
    throw new AssertionError(message ?? `Objects are equal: ${stringify(obj)}`);
}

export function assertIsNotNull<T extends object>(
  result: T | null,
): asserts result is T {
  assertNotEqual(result, null);
  assertOk(result);
}

export function assertIsNull<T extends object>(
  result: T | null,
): asserts result is null {
  assertEqual(result, null);
}

type Call = {
  arguments: unknown[];
  result: unknown;
  target: unknown;
  this: unknown;
};

export type ArgumentMatcher = (arg: unknown) => boolean;

export const argValue =
  <T>(value: T): ArgumentMatcher =>
  (arg) =>
    deepEquals(arg, value);

export const argMatches =
  <T>(matches: (arg: T) => boolean): ArgumentMatcher =>
  (arg) =>
    matches(arg as T);

// eslint-disable-next-line @typescript-eslint/ban-types
export type MockedFunction = Function & { mock?: { calls: Call[] } };

export function verifyThat(fn: MockedFunction) {
  return {
    calledTimes: (times: number) => {
      assertEqual(fn.mock?.calls?.length, times);
    },
    notCalled: () => {
      assertEqual(fn?.mock?.calls?.length, 0);
    },
    called: () => {
      assertTrue(
        fn.mock?.calls.length !== undefined && fn.mock.calls.length > 0,
      );
    },
    calledWith: (...args: unknown[]) => {
      assertTrue(
        fn.mock?.calls.length !== undefined &&
          fn.mock.calls.length >= 1 &&
          fn.mock.calls.some((call) => deepEquals(call.arguments, args)),
      );
    },
    calledOnceWith: (...args: unknown[]) => {
      assertTrue(
        fn.mock?.calls.length !== undefined &&
          fn.mock.calls.length === 1 &&
          fn.mock.calls.some((call) => deepEquals(call.arguments, args)),
      );
    },
    calledWithArgumentMatching: (...matches: ArgumentMatcher[]) => {
      assertTrue(
        fn.mock?.calls.length !== undefined && fn.mock.calls.length >= 1,
      );
      assertTrue(
        fn.mock?.calls.length !== undefined &&
          fn.mock.calls.length >= 1 &&
          fn.mock.calls.some(
            (call) =>
              call.arguments &&
              call.arguments.length >= matches.length &&
              matches.every((match, index) => match(call.arguments[index])),
          ),
      );
    },
    notCalledWithArgumentMatching: (...matches: ArgumentMatcher[]) => {
      assertFalse(
        fn.mock?.calls.length !== undefined &&
          fn.mock.calls.length >= 1 &&
          fn.mock.calls[0]!.arguments &&
          fn.mock.calls[0]!.arguments.length >= matches.length &&
          matches.every((match, index) =>
            match(fn.mock!.calls[0]!.arguments[index]),
          ),
      );
    },
  };
}

export const assertThatArray = <T>(array: T[]) => {
  return {
    isEmpty: () => assertEqual(array.length, 0),
    hasSize: (length: number) => assertEqual(array.length, length),
    containsElements: (...other: T[]) => {
      assertTrue(other.every((ts) => other.some((o) => deepEquals(ts, o))));
    },
    containsExactlyInAnyOrder: (...other: T[]) => {
      assertEqual(array.length, other.length);
      assertTrue(array.every((ts) => other.some((o) => deepEquals(ts, o))));
    },
    containsExactlyInAnyOrderElementsOf: (other: T[]) => {
      assertEqual(array.length, other.length);
      assertTrue(array.every((ts) => other.some((o) => deepEquals(ts, o))));
    },
    containsExactlyElementsOf: (other: T[]) => {
      assertEqual(array.length, other.length);
      for (let i = 0; i < array.length; i++) {
        assertTrue(deepEquals(array[i], other[i]));
      }
    },
    containsExactly: (elem: T) => {
      assertEqual(array.length, 1);
      assertTrue(deepEquals(array[0], elem));
    },
    contains: (elem: T) => {
      assertTrue(array.some((a) => deepEquals(a, elem)));
    },
    containsOnlyOnceElementsOf: (other: T[]) => {
      assertTrue(
        other
          .map((o) => array.filter((a) => deepEquals(a, o)).length)
          .filter((a) => a === 1).length === other.length,
      );
    },
    containsAnyOf: (...other: T[]) => {
      assertTrue(array.some((a) => other.some((o) => deepEquals(a, o))));
    },
    allMatch: (matches: (item: T) => boolean) => {
      assertTrue(array.every(matches));
    },
    anyMatches: (matches: (item: T) => boolean) => {
      assertTrue(array.some(matches));
    },
    allMatchAsync: async (
      matches: (item: T) => Promise<boolean>,
    ): Promise<void> => {
      for (const item of array) {
        assertTrue(await matches(item));
      }
    },
  };
};
