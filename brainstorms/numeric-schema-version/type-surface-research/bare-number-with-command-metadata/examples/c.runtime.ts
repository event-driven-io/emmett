// Run from scratch: tsx c.runtime.ts (imports the factories from work4 sources)
import assert from 'node:assert/strict';
import { command } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work4/packages/emmett/src/typing/command.ts';
import { event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work4/packages/emmett/src/typing/event.ts';
import { message } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work4/packages/emmett/src/typing/message.ts';
import type { Command, Event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work4/packages/emmett/src/typing/index.ts';
import type { C1, C2, D2, Meta, V1, V2, V2m } from './domain';

const productItem = { productId: 'p', quantity: 1 };
const now = new Date('2026-01-01T00:00:00.000Z');
const results: string[] = [];
const hasKey = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepStrictEqual(actual, expected);
  results.push(`ok ${name}`);
};
type C2m = Command<'AddProductItem', D2, Meta, 2>;
type V1m = Event<'ProductItemAdded', { productId: string }, Meta>;

// commands, versioned without declared metadata
const c1 = command<C2>('AddProductItem', { productItem }, 2);
check('command (t, d, 2)', c1, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });
check('command (t, d, 2) has no metadata key', hasKey(c1, 'metadata'), false);
const c2 = command<C2>('AddProductItem', { productItem }, { now }, 2);
check('command (t, d, { now }, 2)', c2, { type: 'AddProductItem', data: { productItem }, metadata: { now }, kind: 'Command', schemaVersion: 2 });
const c3 = command<C2>('AddProductItem', { productItem }, undefined, 2);
check('command (t, d, undefined, 2)', c3, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });
check('command (t, d, undefined, 2) has no metadata key', hasKey(c3, 'metadata'), false);
// versioned with declared metadata
const c4 = command<C2m>('AddProductItem', { productItem }, { tenant: 't' }, 2);
check('command C2m', c4, { type: 'AddProductItem', data: { productItem }, metadata: { tenant: 't' }, kind: 'Command', schemaVersion: 2 });
// unversioned unchanged
const c5 = command<C1>('AddProductItem', { productId: 'p' });
check('command C1', c5, { type: 'AddProductItem', data: { productId: 'p' }, kind: 'Command' });
check('command C1 has no schemaVersion key', hasKey(c5, 'schemaVersion'), false);
const c6 = command<C1>('AddProductItem', { productId: 'p' }, { now });
check('command C1 with now', c6, { type: 'AddProductItem', data: { productId: 'p' }, metadata: { now }, kind: 'Command' });
const c7 = command<C1>('AddProductItem', { productId: 'p' }, undefined);
check('command C1 with undefined', c7, { type: 'AddProductItem', data: { productId: 'p' }, kind: 'Command' });
check('command C1 with undefined has no metadata key', hasKey(c7, 'metadata'), false);

// events
const e1 = event<V2>('ProductItemAdded', { productItem }, 2);
check('event (t, d, 2)', e1, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 2 });
check('event (t, d, 2) has no metadata key', hasKey(e1, 'metadata'), false);
const e2 = event<V2m>('ProductItemAdded', { productItem }, { tenant: 't' }, 2);
check('event (t, d, metadata, 2)', e2, { type: 'ProductItemAdded', data: { productItem }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });
const e3 = event<V1>('ProductItemAdded', { productId: 'p' });
check('event V1', e3, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
const metadataObject = { tenant: 't' };
const e4 = event<V1m>('ProductItemAdded', { productId: 'p' }, metadataObject);
check('event V1m', e4, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event' });
check('event V1m keeps the same metadata object', e4.metadata === metadataObject, true);
check('event V1m has no schemaVersion key', hasKey(e4, 'schemaVersion'), false);

// messages keep kind
const m1 = message<V2>('Event', 'ProductItemAdded', { productItem }, 2);
check('message Event', m1, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 2 });
const m2 = message<C2>('Command', 'AddProductItem', { productItem }, 2);
check('message Command', m2, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });
const m3 = message<V2m>('Event', 'ProductItemAdded', { productItem }, { tenant: 't' }, 2);
check('message with metadata', m3, { type: 'ProductItemAdded', data: { productItem }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });
const m4 = message<V1>('Event', 'ProductItemAdded', { productId: 'p' });
check('message V1', m4, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });

console.log(results.join('\n'));
