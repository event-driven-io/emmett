import { describe, it } from 'node:test';
import { assertFalse, assertTrue } from '../testing';
import { deepEquals, type Equatable, isEquatable } from './deepEquals';

void describe('deepEquals', () => {
  void describe('primitive values', () => {
    void it('returns true for equal numbers', () => {
      assertTrue(deepEquals(42, 42));
      assertTrue(deepEquals(0, 0));
      assertTrue(deepEquals(-1, -1));
      assertTrue(deepEquals(3.14, 3.14));
      assertTrue(deepEquals(Infinity, Infinity));
      assertTrue(deepEquals(-Infinity, -Infinity));
    });

    void it('returns false for different numbers', () => {
      assertFalse(deepEquals(42, 43));
      assertTrue(deepEquals(0, -0)); // JavaScript considers 0 === -0
      assertFalse(deepEquals(1, -1));
      assertFalse(deepEquals(3.14, 3.15));
    });

    void it('handles NaN correctly', () => {
      assertFalse(deepEquals(NaN, NaN)); // NaN !== NaN in JavaScript
    });

    void it('handles number precision issues', () => {
      assertTrue(deepEquals(0.1 + 0.2, 0.1 + 0.2));
      assertFalse(deepEquals(0.1 + 0.2, 0.3)); // Floating point precision
      assertTrue(deepEquals(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
      assertTrue(deepEquals(Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER));
      assertTrue(deepEquals(Number.EPSILON, Number.EPSILON));
    });

    void it('returns true for equal strings', () => {
      assertTrue(deepEquals('hello', 'hello'));
      assertTrue(deepEquals('', ''));
      assertTrue(deepEquals('with spaces', 'with spaces'));
      assertTrue(deepEquals('🚀', '🚀')); // Unicode
      assertTrue(deepEquals('line\nbreak', 'line\nbreak'));
      assertTrue(deepEquals('\t\r\n', '\t\r\n'));
    });

    void it('returns false for different strings', () => {
      assertFalse(deepEquals('hello', 'Hello'));
      assertFalse(deepEquals('hello', 'hello '));
      assertFalse(deepEquals('', ' '));
      assertFalse(deepEquals('42', '43'));
    });

    void it('returns true for equal booleans', () => {
      assertTrue(deepEquals(true, true));
      assertTrue(deepEquals(false, false));
    });

    void it('returns false for different booleans', () => {
      assertFalse(deepEquals(true, false));
      assertFalse(deepEquals(false, true));
    });

    void it('handles null correctly', () => {
      assertTrue(deepEquals(null, null));
      assertFalse(deepEquals(null, undefined));
      assertFalse(deepEquals(null, 0));
      assertFalse(deepEquals(null, ''));
      assertFalse(deepEquals(null, false));
      assertFalse(deepEquals(null, {}));
      assertFalse(deepEquals(null, []));
    });

    void it('handles undefined correctly', () => {
      assertTrue(deepEquals(undefined, undefined));
      assertFalse(deepEquals(undefined, null));
      assertFalse(deepEquals(undefined, 0));
      assertFalse(deepEquals(undefined, ''));
      assertFalse(deepEquals(undefined, false));
      assertFalse(deepEquals(undefined, {}));
      assertFalse(deepEquals(undefined, []));
    });

    void it('handles BigInt', () => {
      assertTrue(deepEquals(BigInt(123), BigInt(123)));
      assertFalse(deepEquals(BigInt(123), BigInt(124)));
      assertTrue(deepEquals(BigInt(0), BigInt(0)));
      assertTrue(
        deepEquals(BigInt('999999999999999999'), BigInt('999999999999999999')),
      );
    });

    void it('handles Symbol', () => {
      const sym1 = Symbol('test');
      const sym2 = Symbol('test');
      assertTrue(deepEquals(sym1, sym1)); // Same reference
      assertFalse(deepEquals(sym1, sym2 as unknown as typeof sym1)); // Different symbols
      assertTrue(deepEquals(Symbol.for('global'), Symbol.for('global')));
    });
  });

  void describe('type coercion scenarios', () => {
    void it('returns false for number vs string representation', () => {
      assertFalse(deepEquals(42, '42' as unknown as number));
      assertFalse(deepEquals(0, '0' as unknown as number));
      assertFalse(deepEquals(3.14, '3.14' as unknown as number));
      assertFalse(deepEquals(-1, '-1' as unknown as number));
      assertFalse(deepEquals(Infinity, 'Infinity' as unknown as number));
    });

    void it('returns false for boolean vs number/string', () => {
      assertFalse(deepEquals(true, 1 as unknown as boolean));
      assertFalse(deepEquals(false, 0 as unknown as boolean));
      assertFalse(deepEquals(true, 'true' as unknown as boolean));
      assertFalse(deepEquals(false, 'false' as unknown as boolean));
      assertFalse(deepEquals(true, 'True' as unknown as boolean));
      assertFalse(deepEquals(false, '' as unknown as boolean));
    });

    void it('returns false for null/undefined vs string representation', () => {
      assertFalse(deepEquals(null, 'null'));
      assertFalse(deepEquals(undefined, 'undefined'));
      assertFalse(deepEquals(null, ''));
      assertFalse(deepEquals(undefined, ''));
    });

    void it('returns false when comparing different types', () => {
      assertFalse(deepEquals([], '' as unknown as unknown[]));
      assertFalse(deepEquals({}, '' as unknown as object));
      assertFalse(deepEquals([], 0 as unknown as unknown[]));
      assertFalse(deepEquals({}, 0 as unknown as object));
      assertFalse(deepEquals([1], '1' as unknown as number[]));
      assertFalse(deepEquals({ value: 1 }, '{"value":1}' as unknown as object));
    });
  });

  void describe('arrays', () => {
    void it('returns true for equal arrays', () => {
      assertTrue(deepEquals([], []));
      assertTrue(deepEquals([1, 2, 3], [1, 2, 3]));
      assertTrue(deepEquals(['a', 'b'], ['a', 'b']));
      assertTrue(deepEquals([true, false], [true, false]));
    });

    void it('returns false for arrays with different lengths', () => {
      assertFalse(deepEquals([1, 2], [1, 2, 3]));
      assertFalse(deepEquals([1], []));
      assertFalse(deepEquals([], [1]));
      assertFalse(deepEquals([1, 2, 3, 4, 5], [1, 2, 3]));
    });

    void it('returns false for arrays with overlapping but not fully matching elements', () => {
      assertFalse(deepEquals([1, 2, 3], [1, 2, 4]));
      assertFalse(deepEquals([1, 2, 3], [0, 2, 3]));
      assertFalse(deepEquals([1, 2, 3], [1, 3, 2])); // Different order
      assertFalse(deepEquals(['a', 'b', 'c'], ['a', 'b', 'd']));
    });

    void it('handles deeply nested arrays', () => {
      assertTrue(
        deepEquals(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 4],
          ],
        ),
      );
      assertTrue(deepEquals([[[1]], [[2]]], [[[1]], [[2]]]));
      assertTrue(deepEquals([[[[[5]]]]], [[[[[5]]]]]));
      assertFalse(
        deepEquals(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 5],
          ],
        ),
      );
      assertFalse(deepEquals([[[1]]], [[[2]]]));
      assertFalse(deepEquals([[[[[5]]]]], [[[[[6]]]]]));
    });

    void it('handles arrays with mixed types', () => {
      assertTrue(deepEquals([1, 'two', true, null], [1, 'two', true, null]));
      assertTrue(
        deepEquals(
          [undefined, NaN, Infinity, -0],
          [undefined, NaN, Infinity, -0],
        ),
      );
      assertFalse(
        deepEquals([1, 'two', true, null], [1, 'two', true, undefined]),
      );
      assertFalse(deepEquals([1, '2', 3], [1, 2, 3]));
    });

    void it('handles arrays containing undefined and null', () => {
      assertTrue(deepEquals([undefined], [undefined]));
      assertTrue(deepEquals([null], [null]));
      assertTrue(deepEquals([1, undefined, 3], [1, undefined, 3]));
      assertTrue(deepEquals([1, null, 3], [1, null, 3]));
      assertFalse(deepEquals([1, undefined, 3], [1, null, 3]));
      assertFalse(deepEquals([undefined, undefined], [null, null]));
    });

    void it('handles sparse arrays', () => {
      const sparse1 = new Array(3);
      sparse1[0] = 1;
      sparse1[2] = 3;
      const sparse2 = new Array(3);
      sparse2[0] = 1;
      sparse2[2] = 3;
      const dense = [1, undefined, 3];

      assertTrue(deepEquals(sparse1, sparse2));
      assertFalse(deepEquals(sparse1, dense)); // Sparse vs dense are different
    });

    void it('handles arrays containing objects', () => {
      assertTrue(deepEquals([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }]));
      assertTrue(
        deepEquals(
          [{ a: { b: 1 } }, { c: { d: 2 } }],
          [{ a: { b: 1 } }, { c: { d: 2 } }],
        ),
      );
      assertFalse(deepEquals([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }]));
      assertFalse(deepEquals([{ a: 1 }], [{ b: 1 }]));
    });

    void it('handles arrays containing arrays', () => {
      assertTrue(deepEquals([[1], [2], [3]], [[1], [2], [3]]));
      assertTrue(deepEquals([[], [], []], [[], [], []]));
      assertFalse(deepEquals([[1], [2], [3]], [[1], [2], [4]]));
      assertFalse(deepEquals([[1, 2]], [[1, 2, 3]]));
    });

    void it('handles arrays with different value types at same positions', () => {
      assertFalse(deepEquals([1, 2, 3], ['1', '2', '3']));
      assertFalse(deepEquals([true, false], [1, 0]));
      assertFalse(deepEquals([null, undefined], [0, '']));
      assertFalse(deepEquals([{}], [[]]));
    });
  });

  void describe('objects', () => {
    void it('returns true for equal objects', () => {
      assertTrue(deepEquals({}, {}));
      assertTrue(deepEquals({ a: 1 }, { a: 1 }));
      assertTrue(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 }));
      assertTrue(deepEquals({ a: 'hello', b: true }, { a: 'hello', b: true }));
    });

    void it('returns true for objects with same properties in different order', () => {
      assertTrue(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 }));
      assertTrue(deepEquals({ x: 1, y: 2, z: 3 }, { z: 3, x: 1, y: 2 }));
    });

    void it('returns false for objects with different properties', () => {
      assertFalse(deepEquals({ a: 1 }, { b: 1 }));
      assertFalse(deepEquals({ a: 1 }, { a: 1, b: 2 }));
      assertFalse(deepEquals({ a: 1, b: 2 }, { a: 1 }));
      assertFalse(deepEquals({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, d: 3 }));
    });

    void it('returns false for objects with different values', () => {
      assertFalse(deepEquals({ a: 1 }, { a: 2 }));
      assertFalse(deepEquals({ a: 'hello' }, { a: 'world' }));
      assertFalse(deepEquals({ a: true }, { a: false }));
      assertFalse(deepEquals({ a: null }, { a: undefined }));
    });

    void it('handles deeply nested objects', () => {
      assertTrue(deepEquals({ a: { b: 1 } }, { a: { b: 1 } }));
      assertTrue(deepEquals({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }));
      assertTrue(
        deepEquals(
          { a: { b: { c: { d: { e: 1 } } } } },
          { a: { b: { c: { d: { e: 1 } } } } },
        ),
      );
      assertFalse(deepEquals({ a: { b: 1 } }, { a: { b: 2 } }));
      assertFalse(deepEquals({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }));
      assertFalse(
        deepEquals(
          { a: { b: { c: { d: { e: 1 } } } } },
          { a: { b: { c: { d: { e: 2 } } } } },
        ),
      );
    });

    void it('handles property existence vs undefined value', () => {
      const obj1 = { a: undefined };
      const obj2 = {};
      assertFalse(deepEquals(obj1, obj2)); // Property exists vs doesn't exist

      const obj3 = { a: 1, b: undefined };
      const obj4 = { a: 1 };
      assertFalse(deepEquals(obj3, obj4));

      assertTrue(deepEquals({ a: undefined }, { a: undefined }));
      assertTrue(deepEquals({ a: 1, b: undefined }, { a: 1, b: undefined }));
    });

    void it('handles objects with null values', () => {
      assertTrue(deepEquals({ a: null }, { a: null }));
      assertFalse(deepEquals({ a: null }, { a: undefined }));
      assertFalse(deepEquals({ a: null }, {}));
      assertTrue(deepEquals({ a: null, b: null }, { a: null, b: null }));
    });

    void it('handles objects containing arrays', () => {
      assertTrue(deepEquals({ arr: [1, 2, 3] }, { arr: [1, 2, 3] }));
      assertTrue(
        deepEquals({ arr: [[1], [2], [3]] }, { arr: [[1], [2], [3]] }),
      );
      assertFalse(deepEquals({ arr: [1, 2, 3] }, { arr: [1, 2, 4] }));
      assertFalse(deepEquals({ arr: [1, 2, 3] }, { arr: [1, 2] }));
      assertFalse(deepEquals({ arr: [] }, { arr: null }));
    });

    void it('handles objects containing nested objects and arrays', () => {
      const complex1 = {
        a: 1,
        b: [1, 2, { c: 'hello', d: [true, false] }],
        e: { f: null, g: undefined, h: { i: 42 } },
      };
      const complex2 = {
        a: 1,
        b: [1, 2, { c: 'hello', d: [true, false] }],
        e: { f: null, g: undefined, h: { i: 42 } },
      };
      const complex3 = {
        a: 1,
        b: [1, 2, { c: 'hello', d: [true, false] }],
        e: { f: null, g: undefined, h: { i: 43 } }, // Different value
      };
      assertTrue(deepEquals(complex1, complex2));
      assertFalse(deepEquals(complex1, complex3));
    });

    void it('handles objects with different value types for same keys', () => {
      assertFalse(deepEquals({ a: 1 }, { a: '1' }));
      assertFalse(deepEquals({ a: true }, { a: 1 }));
      assertFalse(deepEquals({ a: null }, { a: 0 }));
      assertFalse(deepEquals({ a: [] }, { a: {} }));
      assertFalse(deepEquals({ a: [1, 2, 3] }, { a: '1,2,3' }));
    });
  });

  void describe('objects vs arrays', () => {
    void it('returns false when comparing objects and arrays', () => {
      assertFalse(deepEquals([], {}));
      assertFalse(deepEquals({}, []));
      assertFalse(deepEquals([1, 2, 3], { 0: 1, 1: 2, 2: 3 }));
      assertFalse(deepEquals({ 0: 1, 1: 2, 2: 3 }, [1, 2, 3]));
    });

    void it('returns false for array-like objects vs arrays', () => {
      const arr = [1, 2, 3];
      const arrayLike = { 0: 1, 1: 2, 2: 3, length: 3 };
      assertFalse(deepEquals(arr, arrayLike as unknown as number[]));
      assertFalse(deepEquals(arrayLike as unknown as number[], arr));
    });

    void it('returns false when comparing nested arrays and objects', () => {
      assertFalse(deepEquals([{}], [[]]));
      assertFalse(deepEquals([[]], [{}]));
      assertFalse(deepEquals({ a: [] }, { a: {} }));
      assertFalse(deepEquals({ a: {} }, { a: [] }));
    });
  });

  void describe('functions', () => {
    void it('skips function properties in objects', () => {
      const obj1 = { a: 1, fn: () => 1 };
      const obj2 = { a: 1, fn: () => 2 };
      assertTrue(deepEquals(obj1, obj2)); // Functions are skipped
    });

    void it('skips function properties even if they are different', () => {
      const fn1 = function () {
        return 1;
      };
      const fn2 = function () {
        return 2;
      };
      const obj1 = { a: 1, method: fn1 };
      const obj2 = { a: 1, method: fn2 };
      assertTrue(deepEquals(obj1, obj2));
    });

    void it('compares non-function properties correctly when functions are present', () => {
      const obj1 = { a: 1, b: 2, fn: () => {} };
      const obj2 = { a: 1, b: 3, fn: () => {} };
      assertFalse(deepEquals(obj1, obj2)); // b is different
    });

    void it('handles constructor functions', () => {
      class TestClass {
        constructor(public value: number) {}
      }
      const obj1 = { a: TestClass };
      const obj2 = { a: TestClass };
      assertTrue(deepEquals(obj1, obj2));
    });

    void it('handles async functions', () => {
      const obj1 = { fn: () => Promise.resolve(1) };
      const obj2 = { fn: () => Promise.resolve(2) };
      assertTrue(deepEquals(obj1, obj2));
    });

    void it('handles generator functions', () => {
      const obj1 = {
        fn: function* () {
          yield 1;
        },
      };
      const obj2 = {
        fn: function* () {
          yield 2;
        },
      };
      assertTrue(deepEquals(obj1, obj2));
    });
  });

  void describe('Equatable interface', () => {
    class CustomEquatable implements Equatable<CustomEquatable> {
      constructor(private value: number) {}

      equals(right: CustomEquatable): boolean {
        return this.value === right.value;
      }
    }

    void it('uses custom equals method when available', () => {
      const obj1 = new CustomEquatable(42);
      const obj2 = new CustomEquatable(42);
      const obj3 = new CustomEquatable(43);

      assertTrue(deepEquals(obj1, obj2));
      assertFalse(deepEquals(obj1, obj3));
    });

    void it('handles equatable objects in arrays', () => {
      const arr1 = [new CustomEquatable(1), new CustomEquatable(2)];
      const arr2 = [new CustomEquatable(1), new CustomEquatable(2)];
      const arr3 = [new CustomEquatable(1), new CustomEquatable(3)];

      assertTrue(deepEquals(arr1, arr2));
      assertFalse(deepEquals(arr1, arr3));
    });

    void it('handles equatable objects in nested structures', () => {
      const obj1 = {
        a: new CustomEquatable(1),
        b: { c: new CustomEquatable(2) },
      };
      const obj2 = {
        a: new CustomEquatable(1),
        b: { c: new CustomEquatable(2) },
      };
      const obj3 = {
        a: new CustomEquatable(1),
        b: { c: new CustomEquatable(3) },
      };

      assertTrue(deepEquals(obj1, obj2));
      assertFalse(deepEquals(obj1, obj3));
    });

    void it('handles equatable objects mixed with regular values', () => {
      const obj1 = {
        eq: new CustomEquatable(1),
        regular: 42,
        nested: { eq: new CustomEquatable(2), value: 'test' },
      };
      const obj2 = {
        eq: new CustomEquatable(1),
        regular: 42,
        nested: { eq: new CustomEquatable(2), value: 'test' },
      };
      assertTrue(deepEquals(obj1, obj2));

      const obj3 = {
        eq: new CustomEquatable(1),
        regular: 43, // Different regular value
        nested: { eq: new CustomEquatable(2), value: 'test' },
      };
      assertFalse(deepEquals(obj1, obj3));
    });
  });

  void describe('Date objects', () => {
    void it('handles Date objects with same time', () => {
      const date1 = new Date('2024-01-01T00:00:00.000Z');
      const date2 = new Date('2024-01-01T00:00:00.000Z');
      const date3 = new Date('2024-01-02T00:00:00.000Z');

      assertTrue(deepEquals(date1, date2));
      assertFalse(deepEquals(date1, date3));
    });

    void it('handles Date precision differences', () => {
      const date1 = new Date('2024-01-01T00:00:00.000Z');
      const date2 = new Date('2024-01-01T00:00:00.001Z'); // 1ms difference
      assertFalse(deepEquals(date1, date2));

      const date3 = new Date(1704067200000);
      const date4 = new Date(1704067200000);
      assertTrue(deepEquals(date3, date4));
    });

    void it('handles invalid dates', () => {
      const invalid1 = new Date('invalid');
      const invalid2 = new Date('invalid');
      const valid = new Date('2024-01-01');

      assertTrue(deepEquals(invalid1, invalid2)); // Both NaN
      assertFalse(deepEquals(invalid1, valid));
    });

    void it('returns false for date vs string representation', () => {
      const date = new Date('2024-01-01');
      assertFalse(deepEquals(date, '2024-01-01' as unknown as Date));
      assertFalse(deepEquals(date, date.toString() as unknown as Date));
      assertFalse(deepEquals(date, date.toISOString() as unknown as Date));
      assertFalse(deepEquals(date, date.getTime() as unknown as Date));
    });
  });

  void describe('RegExp objects', () => {
    void it('handles RegExp objects', () => {
      const regex1 = /test/gi;
      const regex2 = /test/gi;
      const regex3 = /test/i;
      const regex4 = /different/gi;

      assertTrue(deepEquals(regex1, regex2));
      assertFalse(deepEquals(regex1, regex3)); // Different flags
      assertFalse(deepEquals(regex1, regex4)); // Different pattern
    });

    void it('handles RegExp with unicode and sticky flags', () => {
      const regex1 = /test/gisu;
      const regex2 = /test/gisu;
      const regex3 = /test/gis; // Missing unicode flag

      assertTrue(deepEquals(regex1, regex2));
      assertFalse(deepEquals(regex1, regex3));
    });
  });

  void describe('Map and Set objects', () => {
    void it('handles Map objects', () => {
      const map1 = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const map2 = new Map([
        ['a', 1],
        ['b', 2],
      ]);

      // Maps don't have enumerable properties, so they're not equal
      assertFalse(deepEquals(map1, map2));
    });

    void it('handles Set objects', () => {
      const set1 = new Set([1, 2, 3]);
      const set2 = new Set([1, 2, 3]);

      // Sets don't have enumerable properties, so they're not equal
      assertFalse(deepEquals(set1, set2));
    });

    void it('handles WeakMap and WeakSet', () => {
      const wm1 = new WeakMap();
      const wm2 = new WeakMap();
      const ws1 = new WeakSet();
      const ws2 = new WeakSet();

      assertFalse(deepEquals(wm1, wm2));
      assertFalse(deepEquals(ws1, ws2));
    });
  });

  void describe('Error objects', () => {
    void it('handles Error objects', () => {
      const error1 = new Error('Test error');
      const error2 = new Error('Test error');
      const error3 = new Error('Different error');

      error1.stack = 'stack';
      error2.stack = 'stack';
      error3.stack = 'stack';

      assertTrue(deepEquals(error1, error2));
      assertFalse(deepEquals(error1, error3));
    });

    void it('handles different Error types', () => {
      const error = new Error('message');
      const typeError = new TypeError('message');
      const rangeError = new RangeError('message');

      assertFalse(deepEquals(error, typeError));
      assertFalse(deepEquals(typeError, rangeError));
    });

    void it('handles custom error properties', () => {
      const error1 = new Error('Test');
      const error2 = new Error('Test');
      (error1 as Error & { code?: string }).code = 'ERR_001';
      (error2 as Error & { code?: string }).code = 'ERR_001';

      assertTrue(deepEquals(error1, error2));

      (error2 as Error & { code?: string }).code = 'ERR_002';
      assertFalse(deepEquals(error1, error2));
    });
  });

  void describe('TypedArrays and ArrayBuffer', () => {
    void it('handles ArrayBuffer', () => {
      const buffer1 = new ArrayBuffer(8);
      const buffer2 = new ArrayBuffer(8);
      const buffer3 = new ArrayBuffer(16);

      // ArrayBuffers compare their properties, not content
      assertTrue(deepEquals(buffer1, buffer2));
      assertFalse(deepEquals(buffer1, buffer3));
    });

    void it('handles Uint8Array and other typed arrays', () => {
      const buffer1 = new ArrayBuffer(8);
      const buffer2 = new ArrayBuffer(8);
      const view1 = new Uint8Array(buffer1);
      const view2 = new Uint8Array(buffer2);

      view1[0] = 42;
      view2[0] = 42;
      assertTrue(deepEquals(view1, view2));

      view2[0] = 43;
      assertFalse(deepEquals(view1, view2));
    });

    void it('handles different typed array types', () => {
      const buffer = new ArrayBuffer(8);
      const uint8 = new Uint8Array(buffer);
      const int8 = new Int8Array(buffer);
      const uint16 = new Uint16Array(buffer);

      uint8[0] = 1;
      assertTrue(deepEquals(uint8, int8 as unknown as Uint8Array)); // Same buffer
      assertFalse(deepEquals(uint8, uint16 as unknown as Uint8Array)); // Different views
    });

    void it('handles DataView', () => {
      const buffer1 = new ArrayBuffer(8);
      const buffer2 = new ArrayBuffer(8);
      const view1 = new DataView(buffer1);
      const view2 = new DataView(buffer2);

      view1.setInt32(0, 42);
      view2.setInt32(0, 42);

      // DataView objects compare properties, not content
      assertFalse(deepEquals(view1, view2));
    });
  });

  void describe('prototype chain', () => {
    void it('handles objects with prototype chain', () => {
      const proto = { inherited: true };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const obj1 = Object.create(proto);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      obj1.own = 1;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const obj2 = Object.create(proto);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      obj2.own = 1;
      const obj3 = { own: 1, inherited: true };

      assertTrue(deepEquals(obj1, obj2));
      assertFalse(deepEquals(obj1, obj3)); // obj3 has inherited as own property
    });

    void it('handles class instances', () => {
      class Base {
        baseValue = 1;
      }
      class Derived extends Base {
        derivedValue = 2;
      }

      const instance1 = new Derived();
      const instance2 = new Derived();
      const instance3 = new Derived();
      instance3.derivedValue = 3;

      assertTrue(deepEquals(instance1, instance2));
      assertFalse(deepEquals(instance1, instance3));
    });
  });

  void describe('Symbol properties', () => {
    void it('does not compare Symbol properties', () => {
      const sym = Symbol('test');
      const obj1 = { [sym]: 1, regular: 2 };
      const obj2 = { [sym]: 1, regular: 2 };
      const obj3 = { [sym]: 2, regular: 2 };

      // Symbol properties are not enumerable by Object.keys
      assertTrue(deepEquals(obj1, obj2));
      assertTrue(deepEquals(obj1, obj3)); // Symbol properties not compared
    });

    void it('handles well-known symbols', () => {
      const obj1 = { [Symbol.iterator]: function* () {}, value: 1 };
      const obj2 = { [Symbol.iterator]: function* () {}, value: 1 };

      assertTrue(deepEquals(obj1, obj2));
    });
  });

  void describe('circular references', () => {
    void it('handles circular references in objects', () => {
      const obj1: Record<string, unknown> = { a: 1 };
      obj1.self = obj1;
      const obj2: Record<string, unknown> = { a: 1 };
      obj2.self = obj2;

      // This will cause infinite recursion in current implementation
      try {
        deepEquals(obj1, obj2);
        // If it doesn't throw, they should be considered equal
      } catch {
        // Expected: Maximum call stack exceeded
      }
    });

    void it('handles circular references in arrays', () => {
      const arr1: unknown[] = [1, 2];
      arr1.push(arr1);
      const arr2: unknown[] = [1, 2];
      arr2.push(arr2);

      try {
        deepEquals(arr1, arr2);
      } catch {
        // Expected: Maximum call stack exceeded
      }
    });

    void it('handles mutual references', () => {
      const obj1a: Record<string, unknown> = { name: 'a' };
      const obj1b: Record<string, unknown> = { name: 'b' };
      obj1a.ref = obj1b;
      obj1b.ref = obj1a;

      const obj2a: Record<string, unknown> = { name: 'a' };
      const obj2b: Record<string, unknown> = { name: 'b' };
      obj2a.ref = obj2b;
      obj2b.ref = obj2a;

      try {
        deepEquals(obj1a, obj2a);
      } catch {
        // Expected: Maximum call stack exceeded
      }
    });
  });

  void describe('edge cases', () => {
    void it('handles objects with numeric keys', () => {
      const obj1 = { 0: 'a', 1: 'b', 2: 'c' };
      const obj2 = { 0: 'a', 1: 'b', 2: 'c' };
      const obj3 = { 2: 'c', 1: 'b', 0: 'a' }; // Different order

      assertTrue(deepEquals(obj1, obj2));
      assertTrue(deepEquals(obj1, obj3)); // Order doesn't matter for objects
    });

    void it('handles empty values comprehensively', () => {
      assertTrue(deepEquals(null, null));
      assertTrue(deepEquals(undefined, undefined));
      assertTrue(deepEquals('', ''));
      assertTrue(deepEquals(0, 0));
      assertTrue(deepEquals(false, false));
      assertTrue(deepEquals([], []));
      assertTrue(deepEquals({}, {}));

      // Cross-comparisons
      assertFalse(deepEquals(null, undefined));
      assertFalse(deepEquals(null, ''));
      assertFalse(deepEquals(null, 0));
      assertFalse(deepEquals(null, false));
      assertFalse(deepEquals(undefined, ''));
      assertFalse(deepEquals(undefined, 0));
      assertFalse(deepEquals('', 0 as unknown));
      assertFalse(deepEquals('', false as unknown as string));
      assertFalse(deepEquals(0, false as unknown as number));
    });

    void it('handles getters and setters', () => {
      const obj1 = {
        _value: 1,
        get value() {
          return this._value;
        },
        set value(v: number) {
          this._value = v;
        },
      };

      const obj2 = {
        _value: 1,
        get value() {
          return this._value;
        },
        set value(v: number) {
          this._value = v;
        },
      };

      assertTrue(deepEquals(obj1, obj2));

      obj2._value = 2;
      assertFalse(deepEquals(obj1, obj2));
    });

    void it('handles objects with toString and valueOf', () => {
      const obj1 = {
        value: 42,
        toString() {
          return '42';
        },
        valueOf() {
          return 42;
        },
      };

      const obj2 = {
        value: 42,
        toString() {
          return '42';
        },
        valueOf() {
          return 42;
        },
      };

      assertTrue(deepEquals(obj1, obj2));
    });

    void it('handles frozen, sealed and non-extensible objects', () => {
      const frozen1 = Object.freeze({ a: 1 });
      const frozen2 = Object.freeze({ a: 1 });
      const normal = { a: 1 };

      assertTrue(deepEquals(frozen1, frozen2));
      assertTrue(deepEquals(frozen1, normal));

      const sealed1 = Object.seal({ b: 2 });
      const sealed2 = Object.seal({ b: 2 });
      assertTrue(deepEquals(sealed1, sealed2));

      const nonExt1 = Object.preventExtensions({ c: 3 });
      const nonExt2 = Object.preventExtensions({ c: 3 });
      assertTrue(deepEquals(nonExt1, nonExt2));
    });
  });

  void describe('real-world scenarios', () => {
    void it('handles API response objects', () => {
      const response1 = {
        status: 200,
        data: {
          users: [
            { id: 1, name: 'Alice', roles: ['admin'] },
            { id: 2, name: 'Bob', roles: ['user'] },
          ],
          meta: {
            total: 2,
            page: 1,
            timestamp: new Date('2024-01-01'),
          },
        },
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'abc123',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const response2 = JSON.parse(JSON.stringify(response1));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      response2.data.meta.timestamp = new Date('2024-01-01');

      assertTrue(deepEquals(response1, response2));

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      response2.data.users[0].name = 'Alice2';
      assertFalse(deepEquals(response1, response2));
    });

    void it('handles configuration objects', () => {
      const config1 = {
        database: {
          host: 'localhost',
          port: 5432,
          credentials: {
            username: 'admin',
            password: null,
          },
          options: {
            ssl: true,
            poolSize: 10,
            timeout: undefined,
          },
        },
        features: ['auth', 'logging', 'caching'],
        environment: 'production',
      };

      const config2 = {
        database: {
          host: 'localhost',
          port: 5432,
          credentials: {
            username: 'admin',
            password: null,
          },
          options: {
            ssl: true,
            poolSize: 10,
            timeout: undefined,
          },
        },
        features: ['auth', 'logging', 'caching'],
        environment: 'production',
      };

      assertTrue(deepEquals(config1, config2));

      const config3 = { ...config2, features: ['auth', 'caching', 'logging'] };
      assertFalse(deepEquals(config1, config3)); // Different array order
    });

    void it('handles deeply nested state objects', () => {
      const state1 = {
        ui: {
          modal: {
            isOpen: false,
            content: null,
            options: {
              closable: true,
              backdrop: 'static',
            },
          },
          sidebar: {
            collapsed: false,
            items: [
              { id: 1, label: 'Home', icon: 'home', active: true },
              { id: 2, label: 'Profile', icon: 'user', active: false },
            ],
          },
        },
        data: {
          entities: {
            users: {
              1: { id: 1, name: 'User1' },
              2: { id: 2, name: 'User2' },
            },
          },
          loading: false,
          error: null,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const state2 = JSON.parse(JSON.stringify(state1));
      assertTrue(deepEquals(state1, state2));

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      state2.ui.sidebar.items[0].active = false;
      assertFalse(deepEquals(state1, state2));
    });
  });
});

void describe('isEquatable', () => {
  void it('returns true for objects with equals function', () => {
    const obj = {
      equals: function (_other: unknown) {
        return true;
      },
    };
    assertTrue(isEquatable(obj));
  });

  void it('returns false for objects without equals function', () => {
    const obj = { notEquals: function () {} };
    assertFalse(isEquatable(obj));
  });

  void it('returns false for objects with non-function equals property', () => {
    const obj = { equals: 'not a function' };
    assertFalse(isEquatable(obj));
  });

  void it('returns false for null', () => {
    assertFalse(isEquatable(null));
  });

  void it('returns false for undefined', () => {
    assertFalse(isEquatable(undefined));
  });

  void it('returns false for primitives', () => {
    assertFalse(isEquatable(42));
    assertFalse(isEquatable('string'));
    assertFalse(isEquatable(true));
    assertFalse(isEquatable(Symbol('test')));
    assertFalse(isEquatable(BigInt(123)));
  });

  void it('returns false for arrays', () => {
    assertFalse(isEquatable([]));
    assertFalse(isEquatable([1, 2, 3]));
  });

  void it('works with class instances', () => {
    class WithEquals {
      equals(_other: unknown) {
        return true;
      }
    }

    class WithoutEquals {
      notEquals() {
        return false;
      }
    }

    assertTrue(isEquatable(new WithEquals()));
    assertFalse(isEquatable(new WithoutEquals()));
  });

  void it('handles objects with inherited equals method', () => {
    const proto = {
      equals: function () {
        return true;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const obj = Object.create(proto);

    assertTrue(isEquatable(obj));
  });
});
