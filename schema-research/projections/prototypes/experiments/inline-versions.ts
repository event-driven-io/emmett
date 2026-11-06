// Does a plain array of versions, passed straight to Event(...) or a projection, type each upcast without a versioned() helper?
// Type-checked by npm run check; the cases that must not compile are in tests/inlineVersions.test.ts.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

type Output<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;
type PreviousOutput<S extends readonly unknown[], K> = Output<[never, ...S][K & keyof [never, ...S]]>;
type Migration<Previous, Current> = { upcast: (previous: Previous) => Current; downcast?: (current: Current) => Previous };
type Versions<S extends readonly StandardSchemaV1[]> = {
  [K in keyof S]: { schema: S[K] } & ([PreviousOutput<S, K>] extends [never]
    ? {}
    : PreviousOutput<S, K> extends Output<S[K]>
      ? Partial<Migration<PreviousOutput<S, K>, Output<S[K]>>>
      : Migration<PreviousOutput<S, K>, Output<S[K]>>);
};
type Latest<S extends readonly StandardSchemaV1[]> = S extends readonly [...unknown[], infer Last] ? Output<Last> : never;

export const V1 = z.object({ clientId: z.string(), total: z.number() });
export const V2 = z.object({ clientId: z.string(), totalAmount: z.number() });

export function Event<const T extends string, const S extends readonly StandardSchemaV1[]>(
  type: T,
  options: { data: Versions<S> },
): { type: T; version: S['length']; data: Latest<S> };
export function Event<const T extends string, D extends StandardSchemaV1>(type: T, options: { data: D }): { type: T; version: 1; data: Output<D> };
export function Event(type: string, options: { data: StandardSchemaV1 | readonly { schema: StandardSchemaV1 }[] }) {
  return { type, version: Array.isArray(options.data) ? options.data.length : 1 } as never;
}

export const projection = <const S extends readonly StandardSchemaV1[]>(options: { collectionName: string; schema: Versions<S> }) => ({
  collectionName: options.collectionName,
  version: options.schema.length as S['length'],
});

export const Confirmed = Event('ShoppingCartConfirmed', {
  data: [{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) }],
});
export const confirmedVersion: 2 = Confirmed.version;
export const confirmedData: { clientId: string; totalAmount: number } = Confirmed.data;

export const Opened = Event('ShoppingCartOpened', { data: V1 });
export const openedVersion: 1 = Opened.version;

export const carts = projection({
  collectionName: 'carts',
  schema: [{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) }],
});
export const cartsVersion: 2 = carts.version;

console.log(Confirmed.type, Confirmed.version, Opened.type, Opened.version, carts.collectionName, carts.version);
