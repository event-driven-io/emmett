// Can TypeScript type `upcast`'s argument from the previous version's schema without a hand annotation?
// Three shapes of the versions list. The cases that must not compile are in tests/versionedTypes.test.ts.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

type Output<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;

export const V1 = z.object({ clientId: z.string(), total: z.number() });
export const V2 = z.object({ clientId: z.string(), totalAmount: z.number() });
export const V3 = z.object({ clientId: z.string(), totalAmount: z.number(), note: z.string().optional() });

// 1. A map keyed by version, as in Q31's upcast map.
type MapVersion = { schema: StandardSchemaV1; upcast?: (previous: never) => unknown };
export const byMap = <const Versions extends Record<string, MapVersion>>(versions: Versions) => versions;

// 2. A tuple, each entry typed from the one before through a mapped type.
type PreviousOutput<S extends readonly unknown[], K> = Output<[never, ...S][K & keyof [never, ...S]]>;
type Migration<Previous, Current> = { upcast: (previous: Previous) => Current; downcast?: (current: Current) => Previous };
type TupleVersions<S extends readonly StandardSchemaV1[]> = {
  // upcast may be left out for the first version, and where the previous output already fits this schema
  [K in keyof S]: { schema: S[K] } & ([PreviousOutput<S, K>] extends [never]
    ? {}
    : PreviousOutput<S, K> extends Output<S[K]>
      ? Partial<Migration<PreviousOutput<S, K>, Output<S[K]>>>
      : Migration<PreviousOutput<S, K>, Output<S[K]>>);
};
export const byTuple = <const S extends readonly StandardSchemaV1[]>(versions: TupleVersions<S>) => versions;

byTuple([
  { schema: V1 },
  {
    schema: V2,
    upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }),
    downcast: (v2) => ({ clientId: v2.clientId, total: v2.totalAmount }),
  },
  { schema: V3 },
]);

// 3. A chain: each step knows the previous schema's output type.
type Step<Current> = {
  // upcast may be left out only when the previous output already fits the next schema
  then: <Next extends StandardSchemaV1>(
    schema: Next,
    ...migration: Current extends Output<Next>
      ? [{ upcast?: (previous: Current) => Output<Next>; downcast?: (current: Output<Next>) => Current }?]
      : [{ upcast: (previous: Current) => Output<Next>; downcast?: (current: Output<Next>) => Current }]
  ) => Step<Output<Next>>;
};
export declare const versions: <First extends StandardSchemaV1>(schema: First) => Step<Output<First>>;

versions(V1)
  .then(V2, {
    upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }),
    downcast: (v2) => ({ clientId: v2.clientId, total: v2.totalAmount }),
  })
  .then(V3);
