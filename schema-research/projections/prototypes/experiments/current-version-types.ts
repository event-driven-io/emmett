// Can Event(...) give the code's type from an optional currentVersion, expose every stored version separately,
// and require a downcast on entries after currentVersion? Cases that must not compile are in tests/currentVersionTypes.test.ts.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

type Output<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;
type PreviousOutput<S extends readonly unknown[], K> = Output<[never, ...S][K & keyof [never, ...S]]>;
type Indexes<N extends number, Acc extends unknown[] = []> = Acc['length'] extends N ? Acc : Indexes<N, [...Acc, unknown]>;
type Positions<S extends readonly unknown[], Acc extends unknown[] = [unknown]> = S extends readonly [unknown, ...infer Rest]
  ? Acc['length'] | Positions<Rest, [...Acc, unknown]>
  : never;
type AfterCurrent<K, C extends number> = K extends keyof Indexes<C> ? false : true;

type Upcast<S extends readonly unknown[], K> = [PreviousOutput<S, K>] extends [never]
  ? {}
  : PreviousOutput<S, K> extends Output<S[K & keyof S]>
    ? { upcast?: (previous: PreviousOutput<S, K>) => Output<S[K & keyof S]> }
    : { upcast: (previous: PreviousOutput<S, K>) => Output<S[K & keyof S]> };

type Downcast<S extends readonly unknown[], K, C extends number> = AfterCurrent<K, C> extends true
  ? { downcast: (current: Output<S[K & keyof S]>) => PreviousOutput<S, K> }
  : { downcast?: (current: Output<S[K & keyof S]>) => PreviousOutput<S, K> };

type Versions<S extends readonly StandardSchemaV1[], C extends number> = {
  [K in keyof S]: { schema: S[K] } & Upcast<S, K> & ([PreviousOutput<S, K>] extends [never] ? {} : Downcast<S, K, C>);
};

type StoredVersion<S extends readonly unknown[], Counted extends unknown[] = [unknown]> = S extends readonly [infer First, ...infer Rest]
  ? { schemaVersion: Counted['length']; data: Output<First> } | StoredVersion<Rest, [...Counted, unknown]>
  : never;

export const V1 = z.object({ clientId: z.string(), total: z.number() });
export const V2 = z.object({ clientId: z.string(), totalAmount: z.number() });
export const V3 = z.object({ clientId: z.string(), totalAmount: z.number(), note: z.string() });

export const Event = <const T extends string, const S extends readonly StandardSchemaV1[], const C extends Positions<S> | S['length'] = S['length']>(
  type: T,
  options: { data: Versions<S, C>; currentVersion?: C },
) => {
  const versions = options.data as readonly { schema: StandardSchemaV1 }[];
  return {
    type,
    currentVersion: (options.currentVersion ?? versions.length) as C,
    versions: options.data,
    Type: undefined as unknown as { type: T; data: Output<[never, ...S][C]> },
    Stored: undefined as unknown as { type: T } & StoredVersion<S>,
  };
};

// currentVersion left out: the last entry is current.
export const Confirmed = Event('ShoppingCartConfirmed', {
  data: [{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) }],
});
export type Confirmed = typeof Confirmed.Type;
export const confirmed: Confirmed = { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', totalAmount: 10 } };
export const confirmedCurrent: 2 = Confirmed.currentVersion;

// currentVersion 2 with a prepared v3: the code works with v2, v3 must say how to downcast to v2.
export const Prepared = Event('ShoppingCartConfirmed', {
  data: [
    { schema: V1 },
    { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) },
    { schema: V3, upcast: (v2) => ({ ...v2, note: '' }), downcast: ({ note: _note, ...v2 }) => v2 },
  ],
  currentVersion: 2,
});
export type Prepared = typeof Prepared.Type;
export const prepared: Prepared = { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', totalAmount: 10 } };
export const preparedCurrent: 2 = Prepared.currentVersion;

// Every stored version as a separate type, narrowed by schemaVersion.
export type StoredConfirmed = typeof Prepared.Stored;
export const describe = (stored: StoredConfirmed): string => {
  switch (stored.schemaVersion) {
    case 1:
      return `v1 total ${stored.data.total}`;
    case 2:
      return `v2 totalAmount ${stored.data.totalAmount}`;
    case 3:
      return `v3 note ${stored.data.note}`;
  }
};

console.log('Confirmed current version:', Confirmed.currentVersion, 'entries:', Confirmed.versions.length);
console.log('Prepared current version:', Prepared.currentVersion, 'entries:', Prepared.versions.length);
console.log(describe({ type: 'ShoppingCartConfirmed', schemaVersion: 3, data: { clientId: 'c1', totalAmount: 10, note: 'gift' } }));
