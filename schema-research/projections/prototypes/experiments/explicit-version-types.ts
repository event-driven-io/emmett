// Without currentVersion: each version as its own type, All as the intersection of every version, Any as the union,
// and evolve typed with one picked version, fed by an upcast whose return type names that version.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

type Output<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;
type Message<T extends string, V extends number, D> = { type: T; data: D; metadata: { schemaVersion: V } };

type ByVersion<T extends string, S extends readonly unknown[], Counted extends unknown[] = [unknown]> = S extends readonly [
  infer First,
  ...infer Rest,
]
  ? { [V in Counted['length']]: Message<T, V, Output<First>> } & ByVersion<T, Rest, [...Counted, unknown]>
  : {};
type Intersect<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
type DataOf<S extends readonly unknown[]> = { [K in keyof S]: Output<S[K]> }[number];

export type VersionTypes<T extends string, S extends readonly StandardSchemaV1[]> = ByVersion<T, S> & {
  // schemaVersion sits at the top level because TypeScript does not narrow a union by message.metadata.schemaVersion
  Any: { [V in keyof ByVersion<T, S>]: { schemaVersion: V; message: ByVersion<T, S>[V] } }[keyof ByVersion<T, S>];
  All: { type: T; data: Intersect<DataOf<S>> };
};

export const V1 = z.object({ clientId: z.string(), total: z.number() });
export const V2 = z.object({ clientId: z.string(), totalAmount: z.number() });
export const V3 = z.object({ clientId: z.string(), totalAmount: z.number(), note: z.string() });

export const Event = <const T extends string, const S extends readonly StandardSchemaV1[]>(type: T, options: { data: S }) => ({
  type,
  versions: options.data,
  Versions: undefined as unknown as VersionTypes<T, S>,
});

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', { data: [V1, V2, V3] });
type Versions = typeof ShoppingCartConfirmed.Versions;

export type ConfirmedV2 = Versions[2];
export type AnyConfirmed = Versions['Any'];
export type AllConfirmed = Versions['All'];

// The user's upcast names the version the code works with in its return type; no number is passed at runtime.
export const upcast = ({ schemaVersion, message }: AnyConfirmed): Versions[2] => {
  switch (schemaVersion) {
    case 1:
      return { type: message.type, data: { clientId: message.data.clientId, totalAmount: message.data.total }, metadata: { schemaVersion: 2 } };
    case 2:
      return message;
    case 3: {
      const { note: _note, ...v2 } = message.data;
      return { type: message.type, data: v2, metadata: { schemaVersion: 2 } };
    }
  }
};

type Cart = { clientId: string; total: number };
export const evolve = (state: Cart, event: Versions[2]): Cart => ({ clientId: event.data.clientId, total: state.total + event.data.totalAmount });

const stored: AnyConfirmed[] = [
  { schemaVersion: 1, message: { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', total: 10 }, metadata: { schemaVersion: 1 } } },
  { schemaVersion: 2, message: { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', totalAmount: 5 }, metadata: { schemaVersion: 2 } } },
  { schemaVersion: 3, message: { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', totalAmount: 1, note: 'gift' }, metadata: { schemaVersion: 3 } } },
];
console.log('evolve over v1, v2, v3 upcast to v2:', stored.map(upcast).reduce(evolve, { clientId: '', total: 0 }));

// A value of All has the fields of every version, so a reader of any version can parse it.
const all: AllConfirmed = { type: 'ShoppingCartConfirmed', data: { clientId: 'c1', total: 10, totalAmount: 10, note: 'gift' } };
console.log('All parsed by V1:', V1.safeParse(all.data).success, 'V2:', V2.safeParse(all.data).success, 'V3:', V3.safeParse(all.data).success);
