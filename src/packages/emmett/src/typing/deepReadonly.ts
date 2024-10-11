type Primitive =
  | undefined
  | null
  | boolean
  | string
  | number
  | bigint
  | symbol
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  | Function;
type ImmutableTypes = Date | RegExp;

export type DeepReadonly<T> = T extends Primitive | ImmutableTypes
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer M>
        ? ReadonlySet<DeepReadonly<M>>
        : T extends Promise<infer U>
          ? Promise<DeepReadonly<U>>
          : T extends object
            ? DeepReadonlyObject<T>
            : Readonly<T>;

type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type Mutable<T> = T extends Primitive
  ? T // Primitives are returned as-is
  : T extends ReadonlyArray<infer U>
    ? MutableArray<U> // Handle ReadonlyArray
    : T extends ReadonlyMap<infer K, infer V>
      ? MutableMap<K, V> // Handle ReadonlyMap
      : T extends ReadonlySet<infer M>
        ? MutableSet<M> // Handle ReadonlySet
        : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
          T extends Function
          ? T // Functions are returned as-is
          : T extends object
            ? MutableObject<T> // Handle objects
            : unknown; // Fallback type if none above match

type MutableArray<T> = Array<Mutable<T>>;
type MutableMap<K, V> = Map<Mutable<K>, Mutable<V>>;
type MutableSet<T> = Set<Mutable<T>>;
type MutableObject<T> = {
  -readonly [P in keyof T]: Mutable<T[P]>;
};
