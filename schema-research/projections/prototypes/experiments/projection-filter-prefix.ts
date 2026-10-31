// What Emmett's projection filter prefixing does to an ObjectId value in the filter.
import { prependMongoFilterWithProjectionPrefix } from '@event-driven-io/emmett-mongodb';
import { ObjectId } from 'mongodb';

const filter = { clientId: new ObjectId('64f000000000000000000001') };
const result = prependMongoFilterWithProjectionPrefix<typeof filter, Record<string, unknown>>(filter, 'projections.summary');
const value = result['projections.summary.clientId'];
console.log('keys of the prefixed value:', Object.keys(value as object));
console.log('still an ObjectId:', value instanceof ObjectId);
console.log('toHexString:', (() => { try { return (value as ObjectId).toHexString(); } catch (e) { return `throws ${(e as Error).message}`; } })());
