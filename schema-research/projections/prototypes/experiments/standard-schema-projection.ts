import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import { MongoClient, ObjectId } from 'mongodb';
import * as z from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/schema.js';

type JSONSchema = Record<string, unknown>;
type StateSchema = StandardSchemaV1 & StandardJSONSchemaV1;

const attempt = async (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(await fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

const hex = '64f000000000000000000001';

// Pluggable type codecs, registered at setup. The MongoDB package would register 'objectid' and 'date-time'.
type TypeCodec = { bsonType: string; toStored: (value: unknown) => unknown; fromStored: (value: unknown) => unknown };
const mongoTypes: Record<string, TypeCodec> = {
  objectid: { bsonType: 'objectId', toStored: (v) => (v instanceof ObjectId ? v : new ObjectId(String(v))), fromStored: (v) => (v instanceof ObjectId ? v.toHexString() : v) },
  'date-time': { bsonType: 'date', toStored: (v) => (v instanceof Date ? v : new Date(String(v))), fromStored: (v) => v },
};

// Everything Emmett reads comes from Standard JSON Schema: ~standard.jsonSchema.input(...)
const jsonSchemaOf = (schema: StateSchema): JSONSchema =>
  schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as JSONSchema;

const typedPaths = (json: JSONSchema, prefix = ''): Record<string, TypeCodec> => {
  if (typeof json.format === 'string' && mongoTypes[json.format]) return { [prefix]: mongoTypes[json.format]! };
  const properties = (json.properties ?? {}) as Record<string, JSONSchema>;
  return Object.assign(
    {},
    ...Object.entries(properties).map(([key, child]) => typedPaths(child, prefix ? `${prefix}.${key}` : key)),
  );
};

const toMongoValidator = (json: JSONSchema): JSONSchema => {
  if (typeof json.format === 'string' && mongoTypes[json.format]) return { bsonType: mongoTypes[json.format]!.bsonType };
  const result: JSONSchema = {};
  for (const [key, value] of Object.entries(json)) {
    if (key === '$schema' || key === 'format') continue;
    if (key === 'type' && value === 'integer') result.bsonType = ['int', 'long'];
    else if (key === 'type' && value === 'object') result.bsonType = 'object';
    else if (key === 'properties')
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, JSONSchema>).map(([k, v]) => [k, toMongoValidator(v)]),
      );
    else result[key] = value;
  }
  return result;
};

const encodeByPaths = (doc: Record<string, unknown>, paths: Record<string, TypeCodec>) => {
  const result: Record<string, unknown> = { ...doc };
  for (const [path, codec] of Object.entries(paths)) if (path in result) result[path] = codec.toStored(result[path]);
  return result;
};

const decodeByPaths = (doc: Record<string, unknown>, paths: Record<string, TypeCodec>) => {
  const result: Record<string, unknown> = { ...doc };
  for (const [path, codec] of Object.entries(paths)) if (path in result) result[path] = codec.fromStored(result[path]);
  return result;
};

const validate = (schema: StateSchema, value: unknown) => {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('async validation');
  if (result.issues) throw new Error(result.issues.map((i) => i.message).join('; '));
  return result.value;
};

// The same projection state, defined three ways. evolve() produces ownerId as a string,
// because event data came through JSON.
const zodPlain = z.object({ ownerId: z.string(), total: z.number() });
const zodFormat = z.object({ ownerId: z.stringFormat('objectid', /^[0-9a-f]{24}$/), total: z.number() });
const zodCodec = z.object({
  ownerId: z.codec(z.string().regex(/^[0-9a-f]{24}$/), z.instanceof(ObjectId), {
    decode: (h) => new ObjectId(h),
    encode: (id) => id.toHexString(),
  }),
  total: z.number(),
});

// The spec's `s` builder plus one type a plugin adds at setup.
const objectId = () => ({
  ...s.string(),
  jsonSchema: { type: 'string', format: 'objectid' },
  '~standard': {
    ...s.string()['~standard'],
    jsonSchema: { input: () => ({ type: 'string', format: 'objectid' }), output: () => ({ type: 'string', format: 'objectid' }) },
  },
});
const sBuilder = s.object({ ownerId: objectId(), total: s.number() });

const schemas: Record<string, StateSchema> = { zodPlain, zodFormat, zodCodec, sBuilder };
const evolved = { ownerId: hex, total: 100 };

console.log('--- 1. What Standard Schema gives Emmett');
for (const [name, schema] of Object.entries(schemas)) {
  await attempt(`${name} jsonSchema.input`, () => jsonSchemaOf(schema));
  await attempt(`${name} validate(evolved) value type of ownerId`, () => {
    const v = validate(schema, evolved) as { ownerId: unknown };
    return v.ownerId instanceof ObjectId ? 'ObjectId' : typeof v.ownerId;
  });
  await attempt(`${name} validate(read back from Mongo, ownerId is ObjectId)`, () =>
    validate(schema, { ownerId: new ObjectId(hex), total: 100 }) !== undefined,
  );
  await attempt(`${name} typed paths found`, () => Object.keys(typedPaths(jsonSchemaOf(schema))));
}

console.log('--- 2. Against MongoDB 8, inline projection at projections.summary in the stream document');
const client = new MongoClient('mongodb://localhost:27099');
await client.connect();
const db = client.db('poc_standard_schema');
await db.dropDatabase();

for (const [name, schema] of Object.entries(schemas)) {
  const json = jsonSchemaOf(schema);
  const paths = typedPaths(json);
  const validator = { $jsonSchema: { bsonType: 'object', properties: { projections: { bsonType: 'object', properties: { summary: toMongoValidator(json) } } } } };
  const collection = db.collection(`emt_${name}`);
  await attempt(`${name} create collection with derived validator`, async () => {
    await db.createCollection(`emt_${name}`, { validator, validationAction: 'error' });
    return validator.$jsonSchema.properties.projections.properties.summary;
  });
  await collection.insertOne({ streamName: `cart-${name}`, messages: [] });

  await attempt(`${name} $set evolved state as is`, async () =>
    (await collection.updateOne({ streamName: `cart-${name}` }, { $set: { 'projections.summary': evolved } })).modifiedCount,
  );
  await attempt(`${name} $set validate() output`, async () =>
    (await collection.updateOne({ streamName: `cart-${name}` }, { $set: { 'projections.summary': validate(schema, evolved) } })).modifiedCount,
  );
  await attempt(`${name} $set encoded by typed paths`, async () =>
    (await collection.updateOne({ streamName: `cart-${name}` }, { $set: { 'projections.summary': encodeByPaths(evolved, paths) } })).modifiedCount,
  );
  await attempt(`${name} find with string filter as is`, () => collection.countDocuments({ 'projections.summary.ownerId': hex }));
  await attempt(`${name} find with filter encoded by typed paths`, () =>
    collection.countDocuments(Object.fromEntries(Object.entries(encodeByPaths({ ownerId: hex }, paths)).map(([k, v]) => [`projections.summary.${k}`, v]))),
  );
  await attempt(`${name} read back, decode by typed paths, validate`, async () => {
    const stored = (await collection.findOne({ streamName: `cart-${name}` }))!.projections.summary as Record<string, unknown>;
    return validate(schema, decodeByPaths(stored, paths));
  });
}

await client.close();
