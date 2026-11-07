// Run from scratch: tsx o1c.runtime.ts (imports the factories from work3 sources)
import assert from 'node:assert/strict';
import { command } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work3/packages/emmett/src/typing/command.ts';
import { event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work3/packages/emmett/src/typing/event.ts';
import { message } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work3/packages/emmett/src/typing/message.ts';
import type { Command, Event } from '/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/work3/packages/emmett/src/typing/index.ts';
import type { C1, C2, V1, V2, V2m } from './domain';

const productItem = { productId: 'p', quantity: 1 };
const now = new Date('2026-01-01T00:00:00.000Z');
const results: string[] = [];
const hasKey = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepStrictEqual(actual, expected);
  results.push(`ok ${name}`);
};

type V1m = Event<'ProductItemAdded', { productId: string }, { tenant: string }>;
// a loose signature for the cases the types reject
const looseEvent = event as unknown as (type: string, data: object, metadata?: object) => Record<string, unknown>;
const looseCommand = command as unknown as (type: string, data: object, metadata?: object) => Record<string, unknown>;

// a number is lifted, metadata left out when empty
const e2 = event<V2>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
check('number lifted', e2, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 2 });
check('no metadata key when empty', hasKey(e2, 'metadata'), false);

// metadata kept when other keys remain
const e2m = event<V2m>('ProductItemAdded', { productItem }, { tenant: 't', schemaVersion: 2 });
check('metadata kept', e2m, { type: 'ProductItemAdded', data: { productItem }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });

// a digit string is lifted as a number (cast: types reject it)
const eDigits = looseEvent('ProductItemAdded', { productItem }, { tenant: 't', schemaVersion: '2' });
check("digit string '2' lifted as 2", eDigits, { type: 'ProductItemAdded', data: { productItem }, metadata: { tenant: 't' }, kind: 'Event', schemaVersion: 2 });
const eDigitsOnly = looseEvent('ProductItemAdded', { productItem }, { schemaVersion: '10' });
check("digit string '10' only", eDigitsOnly, { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', schemaVersion: 10 });

// a non-numeric value is removed and not lifted
const eV2 = looseEvent('ProductItemAdded', { productId: 'p' }, { tenant: 't', schemaVersion: 'v2' });
check("'v2' removed, not lifted", eV2, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event' });
check("'v2' gives no schemaVersion key", hasKey(eV2, 'schemaVersion'), false);
const eV2only = looseEvent('ProductItemAdded', { productId: 'p' }, { schemaVersion: 'v2' });
check("'v2' alone leaves no metadata and no version", eV2only, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
const eFloat = looseEvent('ProductItemAdded', { productId: 'p' }, { schemaVersion: 2.5 });
check('2.5 removed, not lifted', eFloat, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
const eDecimalString = looseEvent('ProductItemAdded', { productId: 'p' }, { schemaVersion: '2.0' });
check("'2.0' removed, not lifted", eDecimalString, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
const eUndefined = looseEvent('ProductItemAdded', { productId: 'p' }, { tenant: 't', schemaVersion: undefined });
check('undefined removed', eUndefined, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event' });

// a wide V1 variable (types reject it): the numeric version is lifted
const cWide = looseCommand('AddProductItem', { productId: 'p' }, { now, schemaVersion: 2 });
check('wide command variable lifted', cWide, { type: 'AddProductItem', data: { productId: 'p' }, metadata: { now }, kind: 'Command', schemaVersion: 2 });

// commands and messages
const c2 = command<C2>('AddProductItem', { productItem }, { schemaVersion: 2 });
check('command version only', c2, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });
const c2now = command<C2>('AddProductItem', { productItem }, { now, schemaVersion: 2 });
check('command with now', c2now, { type: 'AddProductItem', data: { productItem }, metadata: { now }, kind: 'Command', schemaVersion: 2 });
const m2 = message<C2>('Command', 'AddProductItem', { productItem }, { schemaVersion: 2 });
check('message keeps kind', m2, { type: 'AddProductItem', data: { productItem }, kind: 'Command', schemaVersion: 2 });

// unversioned calls without the key are unchanged
const e1 = event<V1>('ProductItemAdded', { productId: 'p' });
check('V1 unchanged', e1, { type: 'ProductItemAdded', data: { productId: 'p' }, kind: 'Event' });
const metadataObject = { tenant: 't' };
const e1m = event<V1m>('ProductItemAdded', { productId: 'p' }, metadataObject);
check('V1m unchanged', e1m, { type: 'ProductItemAdded', data: { productId: 'p' }, metadata: { tenant: 't' }, kind: 'Event' });
check('V1m keeps the same metadata object', e1m.metadata === metadataObject, true);
const c1 = command<C1>('AddProductItem', { productId: 'p' }, { now });
check('C1 with now unchanged', c1, { type: 'AddProductItem', data: { productId: 'p' }, metadata: { now }, kind: 'Command' });
const c1none = command<C1>('AddProductItem', { productId: 'p' });
check('C1 without metadata unchanged', c1none, { type: 'AddProductItem', data: { productId: 'p' }, kind: 'Command' });
type CEmpty = Command<'X', { a: number }, Record<string, never>>;
check('unversioned empty metadata unchanged', command<CEmpty>('X', { a: 1 }, {}), { type: 'X', data: { a: 1 }, metadata: {}, kind: 'Command' });

console.log(results.join('\n'));
