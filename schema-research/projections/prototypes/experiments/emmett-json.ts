import { JSONSerializer } from '@event-driven-io/emmett';

const serializer = JSONSerializer;
const json = serializer.serialize({
  confirmedAt: new Date('2026-10-31T10:00:00.000Z'),
  note: '2026-10-31T10:00:00.000Z',
  small: 5n,
});
console.log('serialized:', json);
const parsed = serializer.deserialize<Record<string, unknown>>(json, { parseDates: true, parseBigInts: true });
for (const [key, value] of Object.entries(parsed))
  console.log(`${key}:`, value instanceof Date ? 'Date' : typeof value, String(value));
