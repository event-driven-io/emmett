// What does upcasting step by step cost, compared with one direct function, conversion and a MongoDB read?
// Needs MongoDB on localhost:27099.
import { MongoClient } from 'mongodb';
import { mongoDBFormats } from '../lib/mongoDBSchema.js';
import { documentCodec } from '../lib/projectionSchema.js';
import { z } from 'zod';

const isoDate = z.codec(z.iso.datetime(), z.date(), { decode: (iso) => new Date(iso), encode: (date) => date.toISOString() });
const V1 = z.object({ orderId: z.string(), placedAt: isoDate, total: z.number() });

type V1 = { orderId: string; placedAt: Date; total: number };
const v1ToV2 = ({ placedAt, ...rest }: V1) => ({ ...rest, createdAt: placedAt });
const v2ToV3 = ({ total, ...rest }: ReturnType<typeof v1ToV2>) => ({ ...rest, total: { amount: total, currency: 'EUR' } });
const v3ToV4 = (v3: ReturnType<typeof v2ToV3>) => ({ ...v3, note: undefined as string | undefined });
const steps = [v1ToV2, v2ToV3, v3ToV4] as ((value: unknown) => unknown)[];
const direct = ({ placedAt, total, ...rest }: V1) => ({ ...rest, createdAt: placedAt, total: { amount: total, currency: 'EUR' }, note: undefined });

const nanosecondsPer = (runs: number, fn: () => unknown) => {
  for (let i = 0; i < 10_000; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  return Number(process.hrtime.bigint() - start) / runs;
};

const order: V1 = { orderId: 'order-1', placedAt: new Date('2026-10-31T10:00:00.000Z'), total: 100 };
const codec = documentCodec(V1, mongoDBFormats);
const client = new MongoClient('mongodb://localhost:27099/upcast_steps_cost');
await client.connect();
await client.db().dropDatabase();
const orders = client.db().collection('orders');
await orders.insertOne(codec.write(order));
const stored = (await orders.findOne({}, { projection: { _id: 0 } }))!;

const runs = 1_000_000;
console.log(`v1 -> v4 in 3 steps:      ${nanosecondsPer(runs, () => steps.reduce((value, step) => step(value), order as unknown)).toFixed(0)} ns`);
console.log(`v1 -> v4 in one function: ${nanosecondsPer(runs, () => direct(order)).toFixed(0)} ns`);
console.log(`conversion of the stored document (codec.read): ${nanosecondsPer(runs, () => codec.read(stored)).toFixed(0)} ns`);

const reads = 2_000;
const start = process.hrtime.bigint();
for (let i = 0; i < reads; i++) await orders.findOne({ orderId: 'order-1' });
console.log(`MongoDB findOne on localhost: ${(Number(process.hrtime.bigint() - start) / reads).toFixed(0)} ns`);
await client.close();
