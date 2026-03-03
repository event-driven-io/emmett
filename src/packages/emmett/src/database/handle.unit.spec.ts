import { beforeEach, describe, it } from 'vitest';
import { assertDeepEqual, assertEqual, assertOk } from '../testing/assertions';
import {
  type InMemoryDocumentsCollection,
  getInMemoryDatabase,
} from './inMemoryDatabase';

type History = { street: string };
type Address = {
  city: string;
  street?: string;
  zip?: string;
  history?: History[];
};

type User = {
  _id?: string;
  name: string;
  age: number;
  address?: Address;
  tags?: string[];
  _version?: bigint;
};

void describe('InMemoryDatabase Handle Operations', () => {
  let users: InMemoryDocumentsCollection<User>;

  beforeEach(() => {
    const db = getInMemoryDatabase();
    users = db.collection<User>('users');
  });

  void it('should NOT insert a new document if it does not exist and expected DOCUMENT_EXISTS', async () => {
    const nonExistingId = 'test';
    const newDoc: User = { name: 'John', age: 25 };
    const handle = (_existing: User | null) => newDoc;
    const resultInMemoryDatabase = await users.handle(nonExistingId, handle, {
      expectedVersion: 'DOCUMENT_EXISTS',
    });
    assertEqual(resultInMemoryDatabase.successful, false);
    assertEqual(resultInMemoryDatabase.document, null);
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === nonExistingId,
    );
    assertEqual(inMemoryDatabaseDoc, null);
  });

  void it('should NOT insert a new document if it does not exist and expected is numeric value', async () => {
    const nonExistingId = 'test';
    const newDoc: User = { name: 'John', age: 25 };
    const handle = (_existing: User | null) => newDoc;

    const resultInMemoryDatabase = await users.handle(nonExistingId, handle, {
      expectedVersion: 1n,
    });

    assertEqual(resultInMemoryDatabase.successful, false);
    assertEqual(resultInMemoryDatabase.document, null);
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === nonExistingId,
    );
    assertEqual(inMemoryDatabaseDoc, null);
  });

  void it('should replace an existing document when expected version matches', async () => {
    const existingDoc: User = { _id: 'existingId', name: 'John', age: 25 };
    const updatedDoc: User = { _id: existingDoc._id!, name: 'John', age: 30 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => updatedDoc;

    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
    );

    assertOk(resultInMemoryDatabase.successful);
    assertDeepEqual(resultInMemoryDatabase.document, {
      ...updatedDoc,
      _version: 2n,
    });
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertDeepEqual(inMemoryDatabaseDoc, {
      ...updatedDoc,
      _version: 2n,
    });
  });
  void it('should NOT replace an existing document when expected DOCUMENT_DOES_NOT_EXIST', async () => {
    const existingDoc: User = { _id: 'test', name: 'John', age: 25 };
    const updatedDoc: User = { _id: existingDoc._id!, name: 'John', age: 30 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => updatedDoc;
    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
      {
        expectedVersion: 'DOCUMENT_DOES_NOT_EXIST',
      },
    );
    assertEqual(resultInMemoryDatabase.successful, false);
    assertDeepEqual(resultInMemoryDatabase.document, {
      ...existingDoc,
      _version: 1n,
    });
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertDeepEqual(inMemoryDatabaseDoc, {
      ...existingDoc,
      _version: 1n,
    });
  });
  void it('should NOT replace an existing document when expected version is mismatched ', async () => {
    const existingDoc: User = { _id: 'test', name: 'John', age: 25 };
    const updatedDoc: User = { _id: existingDoc._id!, name: 'John', age: 30 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => updatedDoc;
    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
      {
        expectedVersion: 333n,
      },
    );
    assertEqual(resultInMemoryDatabase.successful, false);
    assertDeepEqual(resultInMemoryDatabase.document, {
      ...existingDoc,
      _version: 1n,
    });
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertDeepEqual(inMemoryDatabaseDoc, {
      ...existingDoc,
      _version: 1n,
    });
  });
  void it('should delete an existing document when expected version matches', async () => {
    const existingDoc: User = { name: 'John', age: 25 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => null;
    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
      {
        expectedVersion: 1n,
      },
    );
    assertOk(resultInMemoryDatabase.successful);
    assertEqual(resultInMemoryDatabase.document, null);
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertEqual(inMemoryDatabaseDoc, null);
  });
  void it('should NOT delete an existing document when expected DOCUMENT_DOES_NOT_EXIST', async () => {
    const existingDoc: User = { name: 'John', age: 25 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => null;
    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
      {
        expectedVersion: 'DOCUMENT_DOES_NOT_EXIST',
      },
    );
    assertEqual(resultInMemoryDatabase.successful, false);
    assertDeepEqual(resultInMemoryDatabase.document, {
      ...existingDoc,
      _id: inMemoryDatabaseInsertResult.insertedId!,
      _version: 1n,
    });
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertDeepEqual(inMemoryDatabaseDoc, {
      ...existingDoc,
      _id: inMemoryDatabaseInsertResult.insertedId!,
      _version: 1n,
    });
  });
  void it('should NOT delete an existing document when expected version is mismatched', async () => {
    const existingDoc: User = { name: 'John', age: 25 };
    const inMemoryDatabaseInsertResult = await users.insertOne(existingDoc);
    const handle = (_existing: User | null) => null;
    const resultInMemoryDatabase = await users.handle(
      inMemoryDatabaseInsertResult.insertedId!,
      handle,
      {
        expectedVersion: 333n,
      },
    );
    assertEqual(resultInMemoryDatabase.successful, false);
    assertDeepEqual(resultInMemoryDatabase.document, {
      ...existingDoc,
      _id: inMemoryDatabaseInsertResult.insertedId!,
      _version: 1n,
    });
    const inMemoryDatabaseDoc = await users.findOne(
      ({ _id }) => _id === inMemoryDatabaseInsertResult.insertedId,
    );
    assertDeepEqual(inMemoryDatabaseDoc, {
      ...existingDoc,
      _id: inMemoryDatabaseInsertResult.insertedId!,
      _version: 1n,
    });
  });
});
