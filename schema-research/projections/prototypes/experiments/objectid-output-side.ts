// Does the output side decide what the code gets for an ObjectId, as it does for dates? Needs MongoDB on localhost:27099.
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import { mongoDBFormats, objectId, objectIdPattern } from '../lib/mongoDBSchema.js';
import { documentCodec, type DocumentSchema } from '../lib/projectionSchema.js';

const objectIdCodec = z.codec(z.stringFormat('objectid', objectIdPattern), z.instanceof(ObjectId), {
  decode: (hex) => new ObjectId(hex),
  encode: (id) => id.toHexString(),
});

const variants: Record<string, DocumentSchema<{ clientId: unknown }>> = {
  's builder, objectId()': s.object({ clientId: objectId() }),
  'zod, z.stringFormat(objectid)': z.object({ clientId: z.stringFormat('objectid', objectIdPattern) }),
  'zod, codec to ObjectId': z.object({ clientId: objectIdCodec }),
};

const client = new MongoClient('mongodb://localhost:27099/objectid_output_side');
await client.connect();
const clientId = '64f000000000000000000001';

for (const [name, schema] of Object.entries(variants)) {
  await client.db().dropDatabase();
  const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true, onRead: true } });
  const collection = client.db().collection('carts');
  await collection.insertOne(codec.write({ clientId: name.includes('codec') ? new ObjectId(clientId) : clientId }));
  const stored = (await collection.findOne({}, { projection: { _id: 0 } }))!;
  const read = codec.read(stored).clientId;
  console.log(`${name}: stored ${stored.clientId?.constructor.name}, code gets ${read instanceof ObjectId ? 'ObjectId' : typeof read} ${String(read)}`);
}

await client.close();
