import { describe, it } from 'node:test';
import { assertDeepEqual, assertEqual, assertOk } from '../testing';
import { getInMemoryDatabase } from './inMemoryDatabase';

type TestUser = {
  name: string;
  age: number;
};

void describe('inMemoryDatabase', () => {
  void it('should correctly insertOne document', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    const result = await collection.insertOne({ age: 10, name: 'test' });

    assertOk(result.successful);
  });

  void it('should not allow inserting one with id that already is there', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    const result = await collection.insertOne({ age: 10, name: 'test' });

    const result2 = await collection.insertOne({
      age: 10,
      name: 'test',
      _id: result.insertedId!,
    });

    assertEqual(result2.successful, false);
  });

  void it('return first record found when using findOne without parameters', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const result = await collection.findOne();

    assertEqual(result?.name, 'test');
  });

  void it('should return the correct one found', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const result = await collection.findOne((c) => c.age === 15);

    assertEqual(result?.name, 'test2');
  });

  void it('should return null when not found', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const result = await collection.findOne((c) => c.age === 20);

    assertEqual(result, null);
  });

  void it('should return empty array when find no results matching found', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const result = await collection.find((c) => c.age === 20);

    assertEqual(result.length, 0);
  });

  void it('should return all results matching found', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ _id: 'test', age: 10, name: 'test' });
    await collection.insertOne({ _id: 'test2', age: 15, name: 'test2' });
    await collection.insertOne({ _id: 'test3', age: 20, name: 'test3' });

    const result = await collection.find((c) => c.age > 10);

    assertDeepEqual(result, [
      { _id: 'test2', _version: 1n, age: 15, name: 'test2' } as TestUser,
      { _id: 'test3', _version: 1n, age: 20, name: 'test3' } as TestUser,
    ]);
  });

  void it('should correctly delete one', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const deleteResult = await collection.deleteOne((c) => c.age === 15);
    const found = await collection.findOne((c) => c.age === 15);

    assertEqual(deleteResult.deletedCount, 1);
    assertEqual(found, null);
  });

  void it('should delete first one when no parameter passed to deleteOne', async () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    await collection.insertOne({ age: 10, name: 'test' });
    await collection.insertOne({ age: 15, name: 'test2' });

    const deleteResult = await collection.deleteOne();
    const found = await collection.findOne((c) => c.age === 10);

    assertEqual(deleteResult.deletedCount, 1);
    assertEqual(found, null);
  });
});
