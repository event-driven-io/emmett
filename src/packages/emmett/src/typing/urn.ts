// // ============================================================================
// // Type definitions
// // ============================================================================
// type URN<T extends `urn:${string}:${string}`> = T;

// interface SegmentSchema<_T = string> {
//   type: 'segment';
//   validator?: (s: string) => boolean;
// }

// interface SegmentsSchema<_T = string> {
//   type: 'segments';
//   validator?: (s: string) => boolean;
// }

// interface LiteralSchema<T extends string> {
//   type: 'literal';
//   value: T;
// }

// type PatternElement =
//   | SegmentSchema<any>
//   | SegmentsSchema<any>
//   | LiteralSchema<any>;

// interface URNSchema<
//   NS extends string = string,
//   P extends readonly PatternElement[] = readonly PatternElement[],
// > {
//   namespace: NS;
//   pattern: P;
// }

// // ============================================================================
// // Schema builder functions - like pongoSchema
// // ============================================================================
// function segment<T = string>(
//   validator?: (s: string) => boolean,
// ): SegmentSchema<T> {
//   return { type: 'segment', validator };
// }

// function segments<T = string>(
//   validator?: (s: string) => boolean,
// ): SegmentsSchema<T> {
//   return { type: 'segments', validator };
// }

// function literal<T extends string>(value: T): LiteralSchema<T> {
//   return { type: 'literal', value };
// }

// function urnSchema<NS extends string, P extends readonly PatternElement[]>(
//   namespace: NS,
//   pattern: P,
// ): URNSchema<NS, P> {
//   return { namespace, pattern };
// }

// // ============================================================================
// // Type inference - extract types from schema
// // ============================================================================
// type InferSegmentType<S> =
//   S extends SegmentSchema<infer T>
//     ? T
//     : S extends SegmentsSchema<infer T>
//       ? T
//       : string;

// // Fixed type inference - check for validator property to distinguish types
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

// type SchemaToURN<S extends URNSchema> =
//   S extends URNSchema<infer NS, infer P>
//     ? P extends readonly []
//       ? `urn:${NS}:` // empty pattern
//       : `urn:${NS}:${PatternToTemplate<P>}`
//     : never;

// // ============================================================================
// // URN Definition
// // ============================================================================
// interface URNDefinition<
//   U extends `urn:${string}:${string}`,
//   S extends URNSchema = URNSchema,
// > {
//   schema: S;
//   validate: (s: string) => s is U;
//   create: (...args: any[]) => U;
//   isParent: (parent: string, child: string) => boolean;
//   isAncestor: (ancestor: string, descendant: string) => boolean;
//   getParent: (urn: string) => string | null;
// }

// function defineURN<S extends URNSchema>(
//   schema: S,
// ): URNDefinition<SchemaToURN<S>, S> {
//   type URNType = SchemaToURN<S>;
//   const prefix = `urn:${schema.namespace}:`;

//   const validate = (s: string): s is URNType => {
//     if (!s.startsWith(prefix)) return false;

//     let remainder = s.slice(prefix.length);
//     if (!remainder) return false;

//     for (let i = 0; i < schema.pattern.length; i++) {
//       const pattern = schema.pattern[i]!;

//       if (pattern.type === 'literal') {
//         if (!remainder.startsWith(pattern.value)) return false;
//         remainder = remainder.slice(pattern.value.length);

//         if (i < schema.pattern.length - 1) {
//           if (!remainder.startsWith(':')) return false;
//           remainder = remainder.slice(1);
//         }
//       } else if (pattern.type === 'segment') {
//         const colonIndex = remainder.indexOf(':');
//         const segment =
//           colonIndex === -1 ? remainder : remainder.slice(0, colonIndex);

//         if (!segment) return false;
//         if (pattern.validator && !pattern.validator(segment)) return false;

//         remainder = colonIndex === -1 ? '' : remainder.slice(colonIndex);

//         if (i < schema.pattern.length - 1) {
//           if (!remainder.startsWith(':')) return false;
//           remainder = remainder.slice(1);
//         }
//       } else if (pattern.type === 'segments') {
//         if (!remainder) return false;

//         if (pattern.validator) {
//           const parts = remainder.split(':');
//           for (const part of parts) {
//             if (!pattern.validator(part)) return false;
//           }
//         }

//         remainder = '';
//       }
//     }

//     return remainder.length === 0;
//   };

//   const create = (...args: any[]): URNType => {
//     const parts: string[] = [];
//     let argIndex = 0;

//     for (const pattern of schema.pattern) {
//       if (pattern.type === 'literal') {
//         parts.push(pattern.value);
//       } else if (pattern.type === 'segment') {
//         parts.push(String(args[argIndex++]));
//       } else if (pattern.type === 'segments') {
//         parts.push(...args.slice(argIndex).map(String));
//         break;
//       }
//     }

//     return `${prefix}${parts.join(':')}` as URNType;
//   };

//   const isParent = (parent: string, child: string): boolean => {
//     if (!child.startsWith(parent + ':')) return false;
//     const remainder = child.slice(parent.length + 1);
//     return !remainder.includes(':');
//   };

//   const isAncestor = (ancestor: string, descendant: string): boolean => {
//     return descendant.startsWith(ancestor + ':');
//   };

//   const getParent = (urn: string): string | null => {
//     const lastColon = urn.lastIndexOf(':');
//     if (lastColon <= 4) return null;
//     const secondLastColon = urn.lastIndexOf(':', lastColon - 1);
//     if (secondLastColon <= 3) return null;
//     return urn.slice(0, lastColon);
//   };

//   return {
//     schema,
//     validate,
//     create,
//     isParent,
//     isAncestor,
//     getParent,
//   };
// }

// // ============================================================================
// // Extend URN from parent
// // ============================================================================
// function extendURN<
//   ParentSchema extends URNSchema,
//   NewPattern extends readonly PatternElement[],
// >(
//   parent: URNDefinition<any, ParentSchema>,
//   additionalPattern: NewPattern,
// ): URNDefinition<
//   any,
//   URNSchema<
//     ParentSchema['namespace'],
//     [...ParentSchema['pattern'], ...NewPattern]
//   >
// > {
//   const newSchema = urnSchema(parent.schema.namespace, [
//     ...parent.schema.pattern,
//     ...additionalPattern,
//   ] as unknown as [...ParentSchema['pattern'], ...NewPattern]);
//   return defineURN(newSchema) as URNDefinition<
//     any,
//     URNSchema<ParentSchema['namespace'], [...ParentSchema['pattern'], ...NewPattern]>
//   >;
// }

// // ============================================================================
// // Usage - now with proper type inference!
// // ============================================================================
// const orgURN = defineURN(urnSchema('org', [segments()]));
// type OrgURN = SchemaToURN<typeof orgURN.schema>; // `urn:org:${string}`

// const teamURN = defineURN(
//   urnSchema('org', [segments(), literal('team'), segments()]),
// );
// type TeamURN = SchemaToURN<typeof teamURN.schema>; // `urn:org:${string}:team:${string}`

// // Extending from parent
// const taskURN = extendURN(teamURN, [
//   literal('task'),
//   segment<number>((s) => /^\d+$/.test(s)),
// ]);
// type TaskURN = SchemaToURN<typeof taskURN.schema>; // `urn:org:${string}:team:${string}:task:${number}`

// // Test
// const myOrg = orgURN.create('acme', 'emea');
// console.log(orgURN.validate('urn:org:acme')); // true

// const myTask = taskURN.create('acme', 'team', 'eng', 'task', 123);
// console.log(taskURN.validate('urn:org:acme:team:eng:task:123')); // true
