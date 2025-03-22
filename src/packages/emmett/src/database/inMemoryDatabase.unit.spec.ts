import { describe, it } from 'node:test';
import { getInMemoryDatabase } from './inMemoryDatabase';
import { equal, ok } from 'node:assert';

type TestUser = {
  name: string;
  age: number;
};

void describe('inMemoryDatabase', () => {
  void it('should correctly insertOne document', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    const result = collection.insertOne({ age: 10, name: 'test' });

    ok(result.successful);
  });

  void it('should not allow inserting one with id that already is there', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    const result = collection.insertOne({ age: 10, name: 'test' });

    const result2 = collection.insertOne({
      age: 10,
      name: 'test',
      _id: result.insertedId!,
    });

    equal(result2.successful, false);
  });

  void it('return first record found when using findOne without parameters', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    collection.insertOne({ age: 10, name: 'test' });
    collection.insertOne({ age: 15, name: 'test2' });

    const result = collection.findOne();

    equal(result!.name, 'test');
  });

  void it('should return the correct one found', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    collection.insertOne({ age: 10, name: 'test' });
    collection.insertOne({ age: 15, name: 'test2' });

    const result = collection.findOne((c) => c.age === 15);

    equal(result!.name, 'test2');
  });

  void it('should return null when not found', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    collection.insertOne({ age: 10, name: 'test' });
    collection.insertOne({ age: 15, name: 'test2' });

    const result = collection.findOne((c) => c.age === 20);

    equal(result, null);
  });

  void it('should correctly delete one', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    collection.insertOne({ age: 10, name: 'test' });
    collection.insertOne({ age: 15, name: 'test2' });

    const deleteResult = collection.deleteOne((c) => c.age === 15);
    const found = collection.findOne((c) => c.age === 15);

    equal(deleteResult.deletedCount, 1);
    equal(found, null);
  });

  void it('should delete first one when no parameter passed to deleteOne', () => {
    const db = getInMemoryDatabase();

    const collection = db.collection<TestUser>('test');

    collection.insertOne({ age: 10, name: 'test' });
    collection.insertOne({ age: 15, name: 'test2' });

    const deleteResult = collection.deleteOne();
    const found = collection.findOne((c) => c.age === 10);

    equal(deleteResult.deletedCount, 1);
    equal(found, null);
  });
});
