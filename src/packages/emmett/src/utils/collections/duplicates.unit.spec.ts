import { describe, it } from 'node:test';
import { assertDeepEqual, assertEqual } from '../../testing';
import { getDuplicates, hasDuplicates } from './duplicates';

void describe('hasDuplicates', () => {
  void it('should return false when the array is empty', () => {
    const arr: number[] = [];
    const result = hasDuplicates(arr, (x) => x);
    assertEqual(result, false, 'Expected false for an empty array');
  });

  void it('should return false when the array has one item', () => {
    const arr = [42];
    const result = hasDuplicates(arr, (x) => x);
    assertEqual(result, false, 'Expected false for a single-item array');
  });

  void it('should return false when the array has no duplicates', () => {
    const nums = [1, 2, 3, 4, 5];
    const result = hasDuplicates(nums, (n) => n);
    assertEqual(result, false, 'Expected hasDuplicates to return false');
  });

  void it('should return true when the array has duplicates', () => {
    const nums = [1, 2, 2, 3, 4];
    const result = hasDuplicates(nums, (n) => n);
    assertEqual(result, true, 'Expected hasDuplicates to return true');
  });

  void it('should handle arrays that contain undefined', () => {
    const arr = [undefined, 1, undefined];
    const result = hasDuplicates(arr, (x) => x);
    // Duplicate of undefined
    assertEqual(
      result,
      true,
      'Expected true when undefined appears more than once',
    );
  });

  void it('should handle predicate returning undefined', () => {
    const arr = [1, 2, 3];
    // Every mapped value is undefined, so effectively all are duplicates
    const result = hasDuplicates(arr, () => undefined);
    assertEqual(
      result,
      true,
      'Expected true because predicate always returns undefined',
    );
  });

  void it('should work with complex objects (by ID key)', () => {
    const people = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 1, name: 'Charlie' },
    ];
    // Duplicate keys: id=1
    const result = hasDuplicates(people, (person) => person.id);
    assertEqual(result, true, 'Expected true because id=1 appears twice');
  });

  void it('should handle complex object as a key (reference check)', () => {
    const objA = { kind: 'A' };
    const objB = { kind: 'B' };
    const arr = [objA, objB, objA];
    // If the predicate returns the object itself, then objA is duplicated
    const result = hasDuplicates(arr, (item) => item);
    assertEqual(
      result,
      true,
      'Expected true because objA repeats by reference',
    );
  });
});

void describe('getDuplicates', () => {
  void it('should return an empty array if the input array is empty', () => {
    const result = getDuplicates([], (x) => x);
    assertDeepEqual(result, [], 'Expected empty array for empty input');
  });

  void it('should return an empty array if there are no duplicates', () => {
    const items = ['apple', 'banana', 'cherry'];
    const result = getDuplicates(items, (item) => item);
    assertDeepEqual(
      result,
      [],
      'Expected an empty array when there are no duplicates',
    );
  });

  void it('should return an empty array if there is only one item', () => {
    const single = [42];
    const result = getDuplicates(single, (x) => x);
    assertDeepEqual(
      result,
      [],
      'Expected an empty array for a single-item array',
    );
  });

  void it('should return the duplicated values (primitives)', () => {
    const items = ['apple', 'banana', 'apple', 'cherry', 'banana'];
    const result = getDuplicates(items, (item) => item);
    // We expect all duplicate items: ['apple', 'apple', 'banana', 'banana']
    // Sort for test stability
    assertDeepEqual(
      result.sort(),
      ['apple', 'apple', 'banana', 'banana'].sort(),
    );
  });

  void it('should handle arrays containing undefined', () => {
    const arr = [undefined, 1, undefined, 2, 1];
    // Duplicates are [undefined, undefined, 1, 1]
    const result = getDuplicates(arr, (x) => x);
    const expected = [undefined, undefined, 1, 1];
    // Sort for consistent test comparison (undefined < number in default JS sorting)
    assertDeepEqual(
      result.sort((a, b) => {
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        return a - b;
      }),
      expected.sort((a, b) => {
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        return a - b;
      }),
    );
  });

  void it('should handle predicate returning undefined', () => {
    const arr = [1, 2, 3, 4, 5];
    // Everything maps to undefined, so the entire array are duplicates
    const result = getDuplicates(arr, () => undefined);
    // The entire array is effectively a single big group of duplicates
    assertEqual(
      result.length,
      arr.length,
      'All items should be duplicates since predicate is always undefined',
    );
  });

  void it('should return the duplicated objects by a specified key', () => {
    const objects = [
      { id: 10, name: 'Alpha' },
      { id: 11, name: 'Bravo' },
      { id: 10, name: 'Charlie' },
      { id: 12, name: 'Delta' },
      { id: 11, name: 'Echo' },
    ];
    const result = getDuplicates(objects, (obj) => obj.id);
    // Duplicates: id=10 (Alpha, Charlie), id=11 (Bravo, Echo) => 4 items total
    assertEqual(result.length, 4, 'Expected four duplicated items');
    // Check the IDs
    const ids = result.map((obj) => obj.id).sort();
    assertDeepEqual(ids, [10, 10, 11, 11]);
  });

  void it('should handle a complex object as the key (reference-based)', () => {
    const keyA = { type: 'A' };
    const keyB = { type: 'B' };
    const arr = [
      { key: keyA, value: 'first' },
      { key: keyB, value: 'second' },
      { key: keyA, value: 'third' },
    ];
    // The duplicates are those having keyA
    const result = getDuplicates(arr, (item) => item.key);
    // Expect 2 items with keyA
    assertEqual(
      result.length,
      2,
      'Expected two items with the same reference keyA',
    );
    // Double-check they match keyA
    const keys = result.map((x) => x.key);
    keys.forEach((k) => assertEqual(k, keyA));
  });

  void it('should return duplicates if entire items (objects) are repeated', () => {
    const itemA = { name: 'A' };
    const itemB = { name: 'B' };
    const arr = [itemA, itemB, itemA, itemB, { name: 'C' }];
    // We want duplicates if the entire object is strictly repeated
    const result = getDuplicates(arr, (x) => x);
    // Expect itemA, itemB to appear twice
    assertEqual(result.length, 4, 'Should contain two itemA and two itemB');
    // Check occurrences
    const countA = result.filter((x) => x === itemA).length;
    const countB = result.filter((x) => x === itemB).length;
    assertEqual(countA, 2, 'itemA repeated exactly twice');
    assertEqual(countB, 2, 'itemB repeated exactly twice');
  });
});
