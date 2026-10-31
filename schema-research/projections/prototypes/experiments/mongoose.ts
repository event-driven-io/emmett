import mongoose, { Schema, Types } from 'mongoose';

const cartSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true },
  total: Number,
  confirmedAt: Date,
  status: { type: String, enum: ['open', 'confirmed'] },
});
const Cart = mongoose.model('Cart', cartSchema);

const cast = Cart.castObject({
  ownerId: '64f000000000000000000001',
  total: '42',
  confirmedAt: '2026-10-31T10:00:00.000Z',
});
console.log('mongoose', mongoose.version);
console.log('castObject ownerId is ObjectId:', cast.ownerId instanceof Types.ObjectId);
console.log('castObject total:', typeof cast.total, cast.total);
console.log('castObject confirmedAt is Date:', cast.confirmedAt instanceof Date);
try {
  Cart.castObject({ ownerId: 'not-an-id' });
} catch (error) {
  console.log('castObject invalid ownerId throws:', (error as Error).name);
}
console.log('toJSONSchema():', JSON.stringify(cartSchema.toJSONSchema()));
console.log('toJSONSchema({ useBsonType: true }):', JSON.stringify(cartSchema.toJSONSchema({ useBsonType: true })));

const { MongoClient } = await import('mongodb');
const client = new MongoClient('mongodb://localhost:27099');
await client.connect();
const db = client.db('poc_mongoose');
await db.dropDatabase();
try {
  await db.createCollection('carts', { validator: { $jsonSchema: cartSchema.toJSONSchema({ useBsonType: true }) } });
  console.log('MongoDB accepts toJSONSchema({ useBsonType: true }) as a validator: true');
} catch (error) {
  console.log('MongoDB rejects bsonType output:', (error as Error).message);
}
try {
  await db.createCollection('carts_plain', { validator: { $jsonSchema: cartSchema.toJSONSchema() } });
  console.log('MongoDB accepts plain toJSONSchema() as a validator: true');
} catch (error) {
  console.log('MongoDB rejects plain toJSONSchema():', (error as Error).message);
}
await client.close();
