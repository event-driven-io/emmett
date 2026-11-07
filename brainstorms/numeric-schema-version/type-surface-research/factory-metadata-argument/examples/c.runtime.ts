// Run from scratch: tsx c.runtime.ts (imports the factories from work2 sources)
import assert from 'node:assert/strict';
import { command } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work2/packages/emmett/src/typing/command.ts';
import { event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work2/packages/emmett/src/typing/event.ts';
import { message } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work2/packages/emmett/src/typing/message.ts';
import type { C1, C2, V1, V2, V2m } from './domain';
import type { Command, Event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work2/packages/emmett/src/typing/index.ts';

const productItem = { productId: 'p', quantity: 1 };
const now = new Date('2026-01-01T00:00:00.000Z');
const results: string[] = [];
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepStrictEqual(actual, expected);
  results.push(`ok ${name}: ${JSON.stringify(actual)}`);
};
const hasKey = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

// lifted version, metadata left out when nothing else remains
const e2 = event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
check('event V2', e2, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 2 });
check('event V2 has no metadata key', hasKey(e2, 'metadata'), false);

// metadata kept when there are other keys
const e2m = event<V2m>('ProductItemAdded', { productItem }, { tenant: 't', schemaVersion: 2 });
check('event V2m', e2m, { type: 'ProductItemAdded', data: { productItem }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });

const c2 = command<C2>('AddProductItem', { productItem }, { schemaVersion: 2 });
check('command C2', c2, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });
check('command C2 has no metadata key', hasKey(c2, 'metadata'), false);
const c2now = command<C2>('AddProductItem', { productItem }, { now, schemaVersion: 2 });
check('command C2 with now', c2now, { type: 'AddProductItem', data: { productItem }, metadata: { now }, kind: 'Command', schemaVersion: 2 });

const m2 = message<V2>('Event', 'ProductItemAdded', { productItem }, { schemaVersion: 2 });
check('message V2', m2, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 2 });
const mc2 = message<C2>('Command', 'AddProductItem', { productItem }, { schemaVersion: 2 });
check('message C2 keeps kind', mc2, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });

// unversioned unchanged
const e1 = event<V1>('ProductItemAdded', { productId: 'p' });
check('event V1', e1, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
check('event V1 has no schemaVersion key', hasKey(e1, 'schemaVersion'), false);
type V1m = Event<'ProductItemAdded', { productId: string }, { tenant: string }>;
const metadataObject = { tenant: 't' };
const e1m = event<V1m>('ProductItemAdded', { productId: 'p' }, metadataObject);
check('event V1m', e1m, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event' });
check('event V1m keeps the same metadata object', e1m.metadata === metadataObject, true);
const c1 = command<C1>('AddProductItem', { productId: 'p' }, { now });
check('command C1 with now', c1, { type: 'AddProductItem', data: { productId: 'p' }, metadata: { now }, kind: 'Command' });
const c1none = command<C1>('AddProductItem', { productId: 'p' });
check('command C1 without metadata', c1none, { type: 'AddProductItem', data: { productId: 'p' }, kind: 'Command' });
type CEmpty = Command<'X', { a: number }, Record<string, never>>;
const cEmpty = command<CEmpty>('X', { a: 1 }, {});
check('unversioned empty metadata stays as today', cEmpty, { type: 'X', data: { a: 1 }, metadata: {}, kind: 'Command' });

// edge: a V1 variable typed with an extra schemaVersion key
type V1mWide = { tenant: string; schemaVersion: number };
const wide: V1mWide = { tenant: 't', schemaVersion: 2 };
const e1wide = event<V1m>('ProductItemAdded', { productId: 'p' }, wide);
check('V1 with a wide variable: the version is lifted', e1wide, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });

// edge: user metadata that declares its own string schemaVersion
type V1s = Event<'ProductItemAdded', { productId: string }, { meta: string; schemaVersion?: string }>;
const e1s = event<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm', schemaVersion: '2' });
check('user string schemaVersion is lifted too', e1s, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { meta: 'm' }, kind: 'Event', schemaVersion: '2' });

// edge: now set to undefined
const c2undef = command<C2>('AddProductItem', { productItem }, { now: undefined, schemaVersion: 2 });
check('now: undefined keeps a metadata key', c2undef, { type: 'AddProductItem', data: { productItem }, metadata: { now: undefined }, kind: 'Command', schemaVersion: 2 });

console.log(results.join('\n'));
export type { Command };
