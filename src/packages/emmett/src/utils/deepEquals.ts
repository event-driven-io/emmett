const compareArrays = <T>(left: T[], right: T[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  // Check for sparse arrays - ensure same indices exist
  for (let i = 0; i < left.length; i++) {
    const leftHas = i in left;
    const rightHas = i in right;
    if (leftHas !== rightHas) return false;
    if (leftHas && !deepEquals(left[i], right[i])) return false;
  }
  return true;
};

const compareDates = (left: Date, right: Date): boolean => {
  return left.getTime() === right.getTime();
};

const compareRegExps = (left: RegExp, right: RegExp): boolean => {
  return left.toString() === right.toString();
};

const compareErrors = (left: Error, right: Error): boolean => {
  // Compare basic error properties including stack
  if (
    left.message !== right.message ||
    left.name !== right.name ||
    left.stack !== right.stack
  ) {
    return false;
  }
  // Then compare any custom properties
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!rightKeys.includes(key)) return false;
    // @ts-expect-error - accessing dynamic keys
    if (!deepEquals(left[key], right[key])) return false;
  }
  return true;
};

const compareMaps = (
  left: Map<unknown, unknown>,
  right: Map<unknown, unknown>,
): boolean => {
  if (left.size !== right.size) return false;

  for (const [key, value] of left) {
    if (!right.has(key) || !deepEquals(value, right.get(key))) {
      return false;
    }
  }
  return true;
};

const compareSets = (left: Set<unknown>, right: Set<unknown>): boolean => {
  if (left.size !== right.size) return false;

  // For sets, we need to check if all elements exist in both
  // This is tricky because Set uses SameValueZero equality
  const leftArray = Array.from(left);
  const rightArray = Array.from(right);

  // Check if every element in left exists in right with deepEquals
  for (const leftItem of leftArray) {
    let found = false;
    for (const rightItem of rightArray) {
      if (deepEquals(leftItem, rightItem)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
};

const compareArrayBuffers = (
  left: ArrayBuffer,
  right: ArrayBuffer,
): boolean => {
  return left.byteLength === right.byteLength;
};

const compareObjects = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  const keys1 = Object.keys(left);
  const keys2 = Object.keys(right);

  if (
    keys1.length !== keys2.length ||
    !keys1.every((key) => keys2.includes(key))
  ) {
    return false;
  }

  for (const key in left) {
    if (left[key] instanceof Function && right[key] instanceof Function) {
      continue;
    }

    const isEqual = deepEquals(left[key], right[key]);
    if (!isEqual) {
      return false;
    }
  }

  return true;
};

const getType = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const primitiveType = typeof value;
  if (primitiveType !== 'object') return primitiveType;

  // Check for specific object types
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof RegExp) return 'regexp';
  if (value instanceof Error) return 'error';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  if (value instanceof ArrayBuffer) return 'arraybuffer';
  if (value instanceof DataView) return 'dataview';
  if (value instanceof WeakMap) return 'weakmap';
  if (value instanceof WeakSet) return 'weakset';

  // TypedArrays
  if (ArrayBuffer.isView(value)) return 'typedarray';

  return 'object';
};

export const deepEquals = <T>(left: T, right: T): boolean => {
  // Handle equatable objects first
  if (isEquatable(left)) {
    return left.equals(right);
  }

  const leftType = getType(left);
  const rightType = getType(right);

  // Different types are never equal
  if (leftType !== rightType) return false;

  // Handle each type
  switch (leftType) {
    case 'null':
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'string':
    case 'symbol':
    case 'function':
      return left === right;

    case 'array':
      return compareArrays(left as unknown[], right as unknown[]);

    case 'date':
      return compareDates(left as Date, right as Date);

    case 'regexp':
      return compareRegExps(left as RegExp, right as RegExp);

    case 'error':
      return compareErrors(left as Error, right as Error);

    case 'map':
      return compareMaps(
        left as Map<unknown, unknown>,
        right as Map<unknown, unknown>,
      );

    case 'set':
      return compareSets(left as Set<unknown>, right as Set<unknown>);

    case 'arraybuffer':
      return compareArrayBuffers(left as ArrayBuffer, right as ArrayBuffer);

    case 'dataview':
    case 'weakmap':
    case 'weakset':
      // These types can't be properly compared
      return false;

    case 'typedarray':
      // TypedArrays are compared as objects with numeric indices
      return compareObjects(
        left as Record<string, unknown>,
        right as Record<string, unknown>,
      );

    case 'object':
      return compareObjects(
        left as Record<string, unknown>,
        right as Record<string, unknown>,
      );

    default:
      return false;
  }
};

export type Equatable<T> = { equals: (right: T) => boolean } & T;

export const isEquatable = <T>(left: T): left is Equatable<T> => {
  return (
    left !== null &&
    left !== undefined &&
    typeof left === 'object' &&
    'equals' in left &&
    typeof left['equals'] === 'function'
  );
};
