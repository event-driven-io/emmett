export * from './deepReadonly';

export * from './command';
export * from './event';
export * from './message';

export * from './decider';
export * from './workflow';

export type Brand<K, T> = K & { readonly __brand: T };
export type Flavour<K, T> = K & { readonly __brand?: T };

export type DefaultRecord = Record<string, unknown>;

export type NonNullable<T> = T extends null | undefined ? never : T;
