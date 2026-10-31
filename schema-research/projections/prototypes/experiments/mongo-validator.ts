import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27099');
await client.connect();
const db = client.db('poc');
await db.dropDatabase();

const attempt = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const result = await fn();
    console.log(`OK    ${label}`, result === undefined ? '' : JSON.stringify(result));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

console.log('MongoDB', (await db.admin().serverInfo()).version);

await db.createCollection('carts', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      properties: { ownerId: { bsonType: 'objectId' } },
    },
  },
});
const carts = db.collection('carts');
const id = new ObjectId();

await attempt('insert ownerId as ObjectId', () => carts.insertOne({ ownerId: id }).then(() => undefined));
await attempt('insert ownerId as string', () => carts.insertOne({ ownerId: id.toHexString() }).then(() => undefined));
await attempt('stored types after inserts', async () =>
  (await carts.find().toArray()).map((d) => d.ownerId instanceof ObjectId ? 'ObjectId' : typeof d.ownerId),
);
await attempt('find with string filter (count)', () => carts.countDocuments({ ownerId: id.toHexString() }));
await attempt('find with ObjectId filter (count)', () => carts.countDocuments({ ownerId: id }));

await attempt('validator using format: date-time', () =>
  db.createCollection('withFormat', {
    validator: { $jsonSchema: { properties: { at: { type: 'string', format: 'date-time' } } } },
  }).then(() => undefined),
);
await attempt('validator using type: integer', () =>
  db.createCollection('withInteger', {
    validator: { $jsonSchema: { properties: { n: { type: 'integer' } } } },
  }).then(() => undefined),
);
await attempt('validator using $schema keyword', () =>
  db.createCollection('withSchemaKeyword', {
    validator: { $jsonSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', properties: {} } },
  }).then(() => undefined),
);
await attempt('validator using numeric exclusiveMinimum (draft 2020-12 style)', () =>
  db.createCollection('withExclusiveMin', {
    validator: { $jsonSchema: { properties: { n: { type: 'number', exclusiveMinimum: 0 } } } },
  }).then(() => undefined),
);
await attempt('validationLevel: constraint', () =>
  db.createCollection('withConstraint', {
    validator: { $jsonSchema: { properties: {} } },
    validationLevel: 'constraint' as 'strict',
  }).then(() => undefined),
);

// Inline projections live inside the stream document, like Emmett's MongoDB store.
await db.createCollection('emt_shopping_cart', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      properties: {
        projections: {
          bsonType: 'object',
          properties: {
            summary: {
              bsonType: ['object', 'null'],
              properties: { ownerId: { bsonType: 'objectId' } },
            },
          },
        },
      },
    },
  },
});
const streams = db.collection('emt_shopping_cart');
await attempt('stream doc without projections', () => streams.insertOne({ streamName: 'a', messages: [] }).then(() => undefined));
await attempt('stream doc, $set projection with ObjectId', () =>
  streams.updateOne({ streamName: 'a' }, { $set: { 'projections.summary': { ownerId: id } } }).then((r) => r.modifiedCount),
);
await attempt('stream doc, $set projection with string', () =>
  streams.updateOne({ streamName: 'a' }, { $set: { 'projections.summary': { ownerId: 'abc' } } }).then((r) => r.modifiedCount),
);

await client.close();
