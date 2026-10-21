// Feasibility check: a dependency-free builder that implements StandardSchemaV1 and
// StandardJSONSchemaV1 together. Not a design proposal, only a size and typing probe.
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import { inspect } from './harness.ts';

type Json = Record<string, unknown>;
type Io = 'input' | 'output';
type Issue = StandardSchemaV1.Issue;
type Meta = { title?: string; description?: string; examples?: unknown[]; deprecated?: boolean; [key: `x-${string}`]: unknown };

type Ctx = { target: string; io: Io; defs: Record<string, Json> };

export type S<In, Out = In> = {
  readonly '~standard': StandardSchemaV1.Props<In, Out> & StandardJSONSchemaV1.Props<In, Out>;
  readonly kind: string;
  readonly meta: Meta;
  readonly optional?: true;
  readonly parse: (value: unknown, path: PropertyKey[], issues: Issue[]) => Out;
  readonly json: (ctx: Ctx) => Json;
  readonly describe: (meta: Meta) => S<In, Out>;
};

export type Input<T extends S<unknown, unknown>> = StandardSchemaV1.InferInput<T>;
export type Output<T extends S<unknown, unknown>> = StandardSchemaV1.InferOutput<T>;

const dialects: Record<string, string | undefined> = {
  'draft-2020-12': 'https://json-schema.org/draft/2020-12/schema',
  'draft-07': 'http://json-schema.org/draft-07/schema#',
  'openapi-3.0': undefined,
};

const make = <In, Out>(
  kind: string,
  parse: S<In, Out>['parse'],
  json: S<In, Out>['json'],
  meta: Meta = {},
  extra: Partial<Pick<S<In, Out>, 'optional'>> = {},
): S<In, Out> => {
  const toJson = (io: Io) => (options: StandardJSONSchemaV1.Options) => {
    if (!(options.target in dialects)) throw new Error(`Unsupported target: ${options.target}`);
    const ctx: Ctx = { target: options.target, io, defs: {} };
    const root = self.json(ctx);
    const dialect = dialects[options.target];
    const defsKey = options.target === 'draft-2020-12' ? '$defs' : 'definitions';
    return {
      ...(dialect ? { $schema: dialect } : {}),
      ...root,
      ...(Object.keys(ctx.defs).length ? { [defsKey]: ctx.defs } : {}),
    };
  };
  const self: S<In, Out> = {
    kind,
    meta,
    ...extra,
    parse,
    json: (ctx) => ({ ...json(ctx), ...meta }),
    describe: (more) => make(kind, parse, json, { ...meta, ...more }, extra),
    '~standard': {
      version: 1,
      vendor: 'emmett',
      validate: (value) => {
        const issues: Issue[] = [];
        const out = parse(value, [], issues);
        return issues.length ? { issues } : { value: out };
      },
      jsonSchema: { input: toJson('input'), output: toJson('output') },
    },
  };
  return self;
};

const fail = <T>(issues: Issue[], path: PropertyKey[], message: string): T => {
  issues.push({ message, path: [...path] });
  return undefined as T;
};

const primitive = <T>(kind: string, test: (v: unknown) => v is T, schema: Json) =>
  make<T, T>(kind, (v, path, issues) => (test(v) ? v : fail(issues, path, `Expected ${kind}`)), () => schema);

export const string = (format?: 'uuid' | 'email' | 'uri') =>
  make<string, string>(
    'string',
    (v, path, issues) => (typeof v === 'string' ? v : fail(issues, path, 'Expected string')),
    () => ({ type: 'string', ...(format ? { format } : {}) }),
  );
export const number = () => primitive('number', (v): v is number => typeof v === 'number' && Number.isFinite(v), { type: 'number' });
export const integer = () => primitive('integer', (v): v is number => Number.isSafeInteger(v), { type: 'integer' });
export const boolean = () => primitive('boolean', (v): v is boolean => typeof v === 'boolean', { type: 'boolean' });

export const literal = <const T extends string | number | boolean>(...values: T[]) =>
  make<T, T>(
    'literal',
    (v, path, issues) => (values.includes(v as T) ? (v as T) : fail(issues, path, `Expected one of ${values.join(', ')}`)),
    () => (values.length === 1 ? { const: values[0] } : { enum: values }),
  );

// Wire form is an ISO string, domain form is Date: input JSON Schema is exact, output is not JSON.
export const date = () =>
  make<string, Date>(
    'date',
    (v, path, issues) => {
      if (v instanceof Date) return v;
      if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v);
      return fail(issues, path, 'Expected ISO 8601 date-time string');
    },
    (ctx) =>
      ctx.io === 'input' ? { type: 'string', format: 'date-time' } : { type: 'string', format: 'date-time', 'x-native-type': 'date' },
  );

export const bigint = () =>
  make<string, bigint>(
    'bigint',
    (v, path, issues) => {
      if (typeof v === 'bigint') return v;
      if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
      return fail(issues, path, 'Expected integer string');
    },
    (ctx) => ({ type: 'string', pattern: '^-?\\d+$', ...(ctx.io === 'output' ? { 'x-native-type': 'bigint' } : {}) }),
  );

export const optional = <I, O>(inner: S<I, O>) =>
  make<I | undefined, O | undefined>(
    inner.kind,
    (v, path, issues) => (v === undefined ? undefined : inner.parse(v, path, issues)),
    inner.json,
    inner.meta,
    { optional: true },
  );

export const nullable = <I, O>(inner: S<I, O>) =>
  make<I | null, O | null>(
    'nullable',
    (v, path, issues) => (v === null ? null : inner.parse(v, path, issues)),
    (ctx) => (ctx.target === 'openapi-3.0' ? { ...inner.json(ctx), nullable: true } : { anyOf: [inner.json(ctx), { type: 'null' }] }),
  );

export const array = <I, O>(item: S<I, O>) =>
  make<I[], O[]>(
    'array',
    (v, path, issues) =>
      Array.isArray(v) ? v.map((x, i) => item.parse(x, [...path, i], issues)) : fail(issues, path, 'Expected array'),
    (ctx) => ({ type: 'array', items: item.json(ctx) }),
  );

export const record = <I, O>(value: S<I, O>) =>
  make<Record<string, I>, Record<string, O>>(
    'record',
    (v, path, issues) =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value.parse(x, [...path, k], issues)]))
        : fail(issues, path, 'Expected object'),
    (ctx) => ({ type: 'object', additionalProperties: value.json(ctx) }),
  );

type Shape = Record<string, S<any, any>>;
type OptionalKeys<T extends Shape> = { [K in keyof T]: T[K]['optional'] extends true ? K : never }[keyof T];
type Flatten<T> = { [K in keyof T]: T[K] } & {};
type ObjectIo<T extends Shape, Side extends 'input' | 'output'> = Flatten<
  { [K in Exclude<keyof T, OptionalKeys<T>>]: NonNullable<T[K]['~standard']['types']>[Side] } & {
    [K in OptionalKeys<T>]?: NonNullable<T[K]['~standard']['types']>[Side];
  }
>;

export const object = <T extends Shape>(shape: T) =>
  make<ObjectIo<T, 'input'>, ObjectIo<T, 'output'>>(
    'object',
    (v, path, issues) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(issues, path, 'Expected object');
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        const raw = (v as Record<string, unknown>)[key];
        if (raw === undefined && !field.optional) fail(issues, [...path, key], 'Required');
        else if (raw !== undefined) out[key] = field.parse(raw, [...path, key], issues);
      }
      return out as ObjectIo<T, 'output'>;
    },
    (ctx) => ({
      type: 'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k, f]) => [k, f.json(ctx)])),
      required: Object.entries(shape).filter(([, f]) => !f.optional).map(([k]) => k),
    }),
  );

export const union = <const T extends S<any, any>[]>(...members: T) =>
  make<Input<T[number]>, Output<T[number]>>(
    'union',
    (v, path, issues) => {
      for (const m of members) {
        const local: Issue[] = [];
        const out = m.parse(v, path, local);
        if (!local.length) return out;
      }
      return fail(issues, path, 'No union member matched');
    },
    (ctx) => ({ anyOf: members.map((m) => m.json(ctx)) }),
  );

// Named schema: emitted once under $defs/definitions and referenced elsewhere.
export const ref = <I, O>(name: string, inner: S<I, O>) =>
  make<I, O>(inner.kind, inner.parse, (ctx) => {
    // An OpenAPI 3.0 Schema Object has no local definitions section, so inline it there.
    if (ctx.target === 'openapi-3.0') return inner.json(ctx);
    ctx.defs[name] ??= inner.json(ctx);
    return { $ref: `${ctx.target === 'draft-2020-12' ? '#/$defs/' : '#/definitions/'}${name}` };
  });

// ---------------------------------------------------------------------------

const Item = ref('CartItem', object({ productId: string(), quantity: integer() }));

const ShoppingCartConfirmed = object({
  cartId: string('uuid').describe({ description: 'Cart id', examples: ['6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10'] }),
  confirmedAt: date(),
  totalAmount: number(),
  itemsCount: integer(),
  status: literal('Confirmed', 'Cancelled'),
  note: optional(string().describe({ deprecated: true })),
  discountCode: nullable(string()),
  items: array(Item),
  tags: record(string()),
  position: optional(bigint()),
}).describe({ title: 'Shopping cart confirmed', description: 'Shopper confirmed the cart', 'x-emmett-kind': 'Event' });

type Wire = Input<typeof ShoppingCartConfirmed>;
type Domain = Output<typeof ShoppingCartConfirmed>;
const wireDate: Wire['confirmedAt'] = '2026-10-04T10:00:00.000Z';
const domainDate: Domain['confirmedAt'] = new Date();
const domainPosition: Domain['position'] = 10n;
const status: Domain['status'] = 'Cancelled';
// @ts-expect-error note is optional, discountCode is required
const missing: Domain = { note: 'x' };
void [wireDate, domainDate, domainPosition, status, missing];

await inspect('built-in prototype', ShoppingCartConfirmed);
