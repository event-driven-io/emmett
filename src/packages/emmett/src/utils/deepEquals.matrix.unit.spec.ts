import { describe, it } from 'node:test';
import { assertFalse, assertTrue } from '../testing';
import { deepEquals } from './deepEquals';

void describe('deepEquals - matrix tests', () => {
  void describe('type symmetry matrix', () => {
    const typeInstances = [
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
      { name: 'boolean', value: true },
      { name: 'number', value: 42 },
      { name: 'string', value: 'test' },
      { name: 'array', value: [1, 2, 3] },
      { name: 'object', value: { a: 1 } },
      { name: 'Date', value: new Date('2024-01-01') },
      { name: 'RegExp', value: /test/gi },
      { name: 'Map', value: new Map([['key', 'value']]) },
      { name: 'Set', value: new Set([1, 2, 3]) },
      {
        name: 'Error',
        value: (() => {
          const e = new Error('test');
          e.stack = 'stack';
          return e;
        })(),
      },
      { name: 'function', value: () => {} },
      { name: 'symbol', value: Symbol('test') },
      { name: 'bigint', value: BigInt(123) },
      { name: 'ArrayBuffer', value: new ArrayBuffer(8) },
      { name: 'DataView', value: new DataView(new ArrayBuffer(8)) },
      { name: 'Int8Array', value: new Int8Array([1, 2, 3]) },
      { name: 'Uint8Array', value: new Uint8Array([1, 2, 3]) },
      { name: 'WeakMap', value: new WeakMap() },
      { name: 'WeakSet', value: new WeakSet() },
    ];

    for (let i = 0; i < typeInstances.length; i++) {
      for (let j = i + 1; j < typeInstances.length; j++) {
        const type1 = typeInstances[i]!;
        const type2 = typeInstances[j]!;

        void it(`${type1.name} vs ${type2.name} - both directions return false`, () => {
          assertFalse(
            deepEquals(type1.value as unknown, type2.value as unknown),
            `Expected ${type1.name} not to equal ${type2.name}`,
          );
          assertFalse(
            deepEquals(type2.value as unknown, type1.value as unknown),
            `Expected ${type2.name} not to equal ${type1.name} (reverse)`,
          );
        });
      }
    }
  });

  void describe('equality matrix', () => {
    const equalityCases: Array<{
      name: string;
      pairs: Array<[unknown, unknown, boolean]>;
    }> = [
      {
        name: 'primitives',
        pairs: [
          [null, null, true],
          [undefined, undefined, true],
          [true, true, true],
          [false, false, true],
          [true, false, false],
          [42, 42, true],
          [42, 43, false],
          ['test', 'test', true],
          ['test', 'other', false],
          [NaN, NaN, false],
          [0, -0, true],
          [Infinity, Infinity, true],
          [-Infinity, -Infinity, true],
          [Infinity, -Infinity, false],
        ],
      },
      {
        name: 'arrays',
        pairs: [
          [[], [], true],
          [[1], [1], true],
          [[1, 2], [1, 2], true],
          [[1, 2], [2, 1], false],
          [[1, [2, 3]], [1, [2, 3]], true],
          [[1, [2, 3]], [1, [3, 2]], false],
          [new Array(3), new Array(3), true],
          // eslint-disable-next-line no-sparse-arrays
          [[, , ,], [undefined, undefined, undefined], false],
        ],
      },
      {
        name: 'objects',
        pairs: [
          [{}, {}, true],
          [{ a: 1 }, { a: 1 }, true],
          [{ a: 1, b: 2 }, { a: 1, b: 2 }, true],
          [{ a: 1, b: 2 }, { b: 2, a: 1 }, true],
          [{ a: 1 }, { a: 2 }, false],
          [{ a: 1 }, { b: 1 }, false],
          [{ a: 1, b: undefined }, { a: 1 }, false],
          [{ a: { b: 1 } }, { a: { b: 1 } }, true],
          [{ a: { b: 1 } }, { a: { b: 2 } }, false],
        ],
      },
      {
        name: 'dates',
        pairs: [
          [new Date('2024-01-01'), new Date('2024-01-01'), true],
          [new Date('2024-01-01'), new Date('2024-01-02'), false],
          [new Date(1704067200000), new Date(1704067200000), true],
          [new Date('invalid'), new Date('invalid'), false],
        ],
      },
      {
        name: 'regexp',
        pairs: [
          [/test/gi, /test/gi, true],
          [/test/gi, /test/g, false],
          [/test/gi, /different/gi, false],
          [/^test$/m, /^test$/m, true],
          [/\d+/u, /\d+/u, true],
          [/\d+/u, /\d+/, false],
        ],
      },
      {
        name: 'maps',
        pairs: [
          [new Map(), new Map(), true],
          [new Map([['a', 1]]), new Map([['a', 1]]), true],
          [
            new Map([
              ['a', 1],
              ['b', 2],
            ]),
            new Map([
              ['b', 2],
              ['a', 1],
            ]),
            true,
          ],
          [new Map([['a', 1]]), new Map([['a', 2]]), false],
          [new Map([['a', 1]]), new Map([['b', 1]]), false],
          [
            new Map([['a', new Map([['inner', 'value']])]]),
            new Map([['a', new Map([['inner', 'value']])]]),
            true,
          ],
        ],
      },
      {
        name: 'sets',
        pairs: [
          [new Set(), new Set(), true],
          [new Set([1, 2, 3]), new Set([1, 2, 3]), true],
          [new Set([1, 2, 3]), new Set([3, 2, 1]), true],
          [new Set([1, 2, 3]), new Set([1, 2, 4]), false],
          [new Set([{ a: 1 }]), new Set([{ a: 1 }]), true],
          [new Set([{ a: 1 }, { b: 2 }]), new Set([{ b: 2 }, { a: 1 }]), true],
        ],
      },
      {
        name: 'typed arrays',
        pairs: [
          [new Int8Array([1, 2, 3]), new Int8Array([1, 2, 3]), true],
          [new Int8Array([1, 2, 3]), new Int8Array([1, 2, 4]), false],
          [new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]), true],
          [new Float32Array([1.1, 2.2]), new Float32Array([1.1, 2.2]), true],
          [new ArrayBuffer(8), new ArrayBuffer(8), true],
          [new ArrayBuffer(8), new ArrayBuffer(16), false],
        ],
      },
      {
        name: 'functions',
        pairs: [
          [() => {}, () => {}, false],
          [function a() {}, function a() {}, false],
          [(x: number) => x, (x: number) => x, false],
        ],
      },
      {
        name: 'symbols',
        pairs: [
          [Symbol.for('test'), Symbol.for('test'), true],
          [Symbol('test'), Symbol('test'), false],
          [Symbol.iterator, Symbol.iterator, true],
        ],
      },
      {
        name: 'bigints',
        pairs: [
          [BigInt(123), BigInt(123), true],
          [BigInt(123), BigInt(456), false],
          [BigInt('9007199254740992'), BigInt('9007199254740992'), true],
        ],
      },
    ];

    for (const { name, pairs } of equalityCases) {
      void describe(name, () => {
        pairs.forEach(([left, right, expected], index) => {
          void it(`case ${index + 1}: ${expected ? 'equal' : 'not equal'}`, () => {
            if (expected) {
              assertTrue(
                deepEquals(left, right),
                `Expected values to be equal`,
              );
              assertTrue(
                deepEquals(right, left),
                `Expected values to be equal (reverse)`,
              );
            } else {
              assertFalse(
                deepEquals(left, right),
                `Expected values not to be equal`,
              );
              assertFalse(
                deepEquals(right, left),
                `Expected values not to be equal (reverse)`,
              );
            }
          });
        });
      });
    }
  });

  void describe('property-based scenarios', () => {
    void it('reflexivity: x equals x', () => {
      const values = [
        null,
        undefined,
        true,
        42,
        'test',
        [1, 2, 3],
        { a: 1, b: { c: 2 } },
        new Date('2024-01-01'),
        new Map([['a', 1]]),
        new Set([1, 2, 3]),
      ];

      values.forEach((value) => {
        assertTrue(deepEquals(value, value));
      });
    });

    void it('symmetry: if x equals y, then y equals x', () => {
      const pairs: Array<[unknown, unknown]> = [
        [{ a: 1 }, { a: 1 }],
        [
          [1, 2],
          [1, 2],
        ],
        [new Date('2024-01-01'), new Date('2024-01-01')],
        [new Map([['a', 1]]), new Map([['a', 1]])],
      ];

      pairs.forEach(([x, y]) => {
        const xEqualsY = deepEquals(x, y);
        const yEqualsX = deepEquals(y, x);
        assertTrue(xEqualsY === yEqualsX, 'Equality should be symmetric');
      });
    });

    void it('transitivity: if x equals y and y equals z, then x equals z', () => {
      const triplets: Array<[unknown, unknown, unknown]> = [
        [{ a: 1 }, { a: 1 }, { a: 1 }],
        [
          [1, 2],
          [1, 2],
          [1, 2],
        ],
        ['test', 'test', 'test'],
      ];

      triplets.forEach(([x, y, z]) => {
        if (deepEquals(x, y) && deepEquals(y, z)) {
          assertTrue(deepEquals(x, z), 'Equality should be transitive');
        }
      });
    });

    void it('consistency: multiple calls return same result', () => {
      const pairs: Array<[unknown, unknown]> = [
        [
          { a: 1, b: 2 },
          { a: 1, b: 2 },
        ],
        [
          [1, [2, 3]],
          [1, [2, 3]],
        ],
        [new Set([1, 2, 3]), new Set([3, 2, 1])],
      ];

      pairs.forEach(([x, y]) => {
        const result1 = deepEquals(x, y);
        const result2 = deepEquals(x, y);
        const result3 = deepEquals(x, y);

        assertTrue(
          result1 === result2 && result2 === result3,
          'Multiple calls should return same result',
        );
      });
    });

    void it('null safety: comparing with null/undefined', () => {
      const values = [0, false, '', [], {}, new Date()];

      values.forEach((value) => {
        assertFalse(deepEquals(value, null as unknown));
        assertFalse(deepEquals(null as unknown, value));
        assertFalse(deepEquals(value, undefined as unknown));
        assertFalse(deepEquals(undefined as unknown, value));
      });

      assertTrue(deepEquals(null, null));
      assertTrue(deepEquals(undefined, undefined));
      assertFalse(deepEquals(null, undefined));
      assertFalse(deepEquals(undefined, null));
    });
  });

  void describe('edge case matrix', () => {
    const edgeCases: Array<{
      name: string;
      value1: unknown;
      value2: unknown;
      expected: boolean;
    }> = [
      {
        name: 'empty objects vs empty arrays',
        value1: {},
        value2: [],
        expected: false,
      },
      {
        name: 'zero vs false',
        value1: 0,
        value2: false,
        expected: false,
      },
      {
        name: 'empty string vs false',
        value1: '',
        value2: false,
        expected: false,
      },
      {
        name: 'null vs undefined',
        value1: null,
        value2: undefined,
        expected: false,
      },
      {
        name: 'NaN in nested structures',
        value1: { a: NaN },
        value2: { a: NaN },
        expected: false,
      },
      {
        name: 'sparse arrays vs undefined arrays',
        // eslint-disable-next-line no-sparse-arrays
        value1: [, , ,],
        value2: [undefined, undefined, undefined],
        expected: false,
      },
      {
        name: 'object with undefined property vs object without property',
        value1: { a: 1, b: undefined },
        value2: { a: 1 },
        expected: false,
      },
      {
        name: 'array-like object vs actual array',
        value1: { 0: 'a', 1: 'b', length: 2 },
        value2: ['a', 'b'],
        expected: false,
      },
      {
        name: 'boxed primitives',
        value1: new String('test'),
        value2: 'test',
        expected: false,
      },
    ];

    edgeCases.forEach(({ name, value1, value2, expected }) => {
      void it(name, () => {
        if (expected) {
          assertTrue(deepEquals(value1, value2));
          assertTrue(deepEquals(value2, value1));
        } else {
          assertFalse(deepEquals(value1, value2));
          assertFalse(deepEquals(value2, value1));
        }
      });
    });
  });
});
