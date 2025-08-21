const isPrimitive = (value: unknown): boolean => {
  const type = typeof value;
  return (
    value === null ||
    value === undefined ||
    type === 'boolean' ||
    type === 'number' ||
    type === 'string' ||
    type === 'symbol' ||
    type === 'bigint'
  );
};

const compareArrays = <T>(left: T[], right: T[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
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
  if (left.message !== right.message || left.name !== right.name) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  const rightKeySet = new Set(rightKeys);
  for (const key of leftKeys) {
    if (!rightKeySet.has(key)) return false;
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
    if (isPrimitive(key)) {
      if (!right.has(key) || !deepEquals(value, right.get(key))) {
        return false;
      }
    } else {
      let found = false;
      for (const [rightKey, rightValue] of right) {
        if (deepEquals(key, rightKey) && deepEquals(value, rightValue)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }
  return true;
};

const compareSets = (left: Set<unknown>, right: Set<unknown>): boolean => {
  if (left.size !== right.size) return false;

  for (const leftItem of left) {
    if (isPrimitive(leftItem)) {
      if (!right.has(leftItem)) return false;
    } else {
      let found = false;
      for (const rightItem of right) {
        if (deepEquals(leftItem, rightItem)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }
  return true;
};

const compareArrayBuffers = (
  left: ArrayBuffer,
  right: ArrayBuffer,
): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  const leftView = new Uint8Array(left);
  const rightView = new Uint8Array(right);
  for (let i = 0; i < leftView.length; i++) {
    if (leftView[i] !== rightView[i]) return false;
  }
  return true;
};

const compareTypedArrays = (
  left: ArrayBufferView,
  right: ArrayBufferView,
): boolean => {
  if (left.constructor !== right.constructor) return false;
  if (left.byteLength !== right.byteLength) return false;

  const leftArray = new Uint8Array(
    left.buffer,
    left.byteOffset,
    left.byteLength,
  );
  const rightArray = new Uint8Array(
    right.buffer,
    right.byteOffset,
    right.byteLength,
  );

  for (let i = 0; i < leftArray.length; i++) {
    if (leftArray[i] !== rightArray[i]) return false;
  }
  return true;
};

const compareObjects = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  const keys1 = Object.keys(left);
  const keys2 = Object.keys(right);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
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

  if (Array.isArray(value)) return 'array';
  if (value instanceof Boolean) return 'boxed-boolean';
  if (value instanceof Number) return 'boxed-number';
  if (value instanceof String) return 'boxed-string';
  if (value instanceof Date) return 'date';
  if (value instanceof RegExp) return 'regexp';
  if (value instanceof Error) return 'error';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  if (value instanceof ArrayBuffer) return 'arraybuffer';
  if (value instanceof DataView) return 'dataview';
  if (value instanceof WeakMap) return 'weakmap';
  if (value instanceof WeakSet) return 'weakset';

  if (ArrayBuffer.isView(value)) return 'typedarray';

  return 'object';
};

export const deepEquals = <T>(left: T, right: T): boolean => {
  if (left === right) return true;

  if (isEquatable(left)) {
    return left.equals(right);
  }

  const leftType = getType(left);
  const rightType = getType(right);

  if (leftType !== rightType) return false;

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
      return false;

    case 'typedarray':
      return compareTypedArrays(
        left as ArrayBufferView,
        right as ArrayBufferView,
      );

    case 'boxed-boolean':
      return (left as boolean).valueOf() === (right as boolean).valueOf();

    case 'boxed-number':
      return (left as number).valueOf() === (right as number).valueOf();

    case 'boxed-string':
      return (left as string).valueOf() === (right as string).valueOf();

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
