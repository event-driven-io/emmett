// Does a recorded event read back from MongoDB carry `kind`, which RecordedMessage marks as required?
// Needs MongoDB on localhost:27099.
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import { getInMemoryEventStore, type Event } from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';

type ProductItemAdded = Event<'ProductItemAdded', { productId: string }>;
const event: ProductItemAdded = { type: 'ProductItemAdded', data: { productId: 'p1' } };

const client = new MongoClient('mongodb://localhost:27099/recorded_kind');
await client.connect();
const mongo = getMongoDBEventStore({ client });
const mongoStream = `shopping_cart-${Date.now()}`;
await mongo.appendToStream(mongoStream, [event]);
const [fromMongo] = (await mongo.readStream<ProductItemAdded>(mongoStream)).events;
console.log('MongoDB: kind in recorded event:', 'kind' in fromMongo!, 'value:', fromMongo!.kind);
await client.close();

const inMemory = getInMemoryEventStore();
await inMemory.appendToStream('shopping_cart-1', [event]);
const [fromMemory] = (await inMemory.readStream<ProductItemAdded>('shopping_cart-1')).events;
console.log('In-memory: kind in recorded event:', 'kind' in fromMemory!, 'value:', fromMemory!.kind);
