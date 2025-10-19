export interface SegmentSchema<_T = string> {
  type: 'segment';
  validator?: (s: string) => boolean;
}

export interface SegmentsSchema<_T = string> {
  type: 'segments';
  validator?: (s: string) => boolean;
}

export interface LiteralSchema<T extends string> {
  type: 'literal';
  value: T;
}

export type PatternElement =
  | SegmentSchema<unknown>
  | SegmentsSchema<unknown>
  | LiteralSchema<string>;

export interface URNSchema<
  NS extends string = string,
  P extends readonly PatternElement[] = readonly PatternElement[],
> {
  namespace: NS;
  pattern: P;
}

export type PatternToTemplate<P> = P extends readonly []
  ? ''
  : P extends readonly [infer First, ...infer Rest]
    ? First extends { type: 'literal'; value: infer V extends string }
      ? Rest extends readonly []
        ? V
        : `${V}:${PatternToTemplate<Rest>}`
      : First extends { type: 'segment'; validator?: unknown }
        ? Rest extends readonly []
          ? `${string}`
          : `${string}:${PatternToTemplate<Rest>}`
        : First extends { type: 'segments'; validator?: unknown }
          ? Rest extends readonly []
            ? `${string}`
            : `${string}:${PatternToTemplate<Rest>}`
          : never
    : never;

export type SchemaToURN<S extends URNSchema> =
  S extends URNSchema<infer NS, infer P>
    ? P extends readonly []
      ? `urn:${NS}:`
      : `urn:${NS}:${PatternToTemplate<P>}`
    : never;

export function segment<T = string>(
  validator?: (s: string) => boolean,
): SegmentSchema<T> {
  return { type: 'segment', validator };
}

export function segments<T = string>(
  validator?: (s: string) => boolean,
): SegmentsSchema<T> {
  return { type: 'segments', validator };
}

export function literal<T extends string>(value: T): LiteralSchema<T> {
  return { type: 'literal', value };
}

export function urnSchema<
  NS extends string,
  P extends readonly PatternElement[],
>(namespace: NS, pattern: P): URNSchema<NS, P> {
  return { namespace, pattern };
}

export interface URNDefinition<
  U extends `urn:${string}:${string}`,
  S extends URNSchema = URNSchema,
> {
  schema: S;
  validate: (s: string) => s is U;
}

export function defineURN<S extends URNSchema>(
  schema: S,
): URNDefinition<SchemaToURN<S>, S> {
  type URNType = SchemaToURN<S>;
  const prefix = `urn:${schema.namespace}:`;

  const validate = (s: string): s is URNType => {
    if (!s.startsWith(prefix)) return false;

    const remainder = s.slice(prefix.length);
    if (!remainder) return false;

    const parts = remainder.split(':');
    let partIndex = 0;

    for (let i = 0; i < schema.pattern.length; i++) {
      const pattern = schema.pattern[i]!;
      if (partIndex >= parts.length) return false;

      if (pattern.type === 'literal') {
        if (parts[partIndex] !== pattern.value) return false;
        partIndex++;
      } else if (pattern.type === 'segment') {
        const part = parts[partIndex]!;
        if (!part) return false;
        if (pattern.validator && !pattern.validator(part)) return false;
        partIndex++;
      } else if (pattern.type === 'segments') {
        const isLast = i === schema.pattern.length - 1;
        if (isLast) {
          const remainingParts = parts.slice(partIndex);
          if (remainingParts.length === 0) return false;
          if (pattern.validator) {
            for (const part of remainingParts) {
              if (!pattern.validator(part)) return false;
            }
          }
          partIndex = parts.length;
        } else {
          if (partIndex >= parts.length) return false;
          const part = parts[partIndex]!;
          if (!part) return false;
          if (pattern.validator && !pattern.validator(part)) return false;
          partIndex++;
        }
      }
    }

    return partIndex === parts.length;
  };

  return {
    schema,
    validate,
  };
}
