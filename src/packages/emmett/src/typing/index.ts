export * from './deepReadonly';

export * from './command';
export * from './event';
export * from './message';
export * from './messageHandling';

export * from './decider';
export * from './workflow';

export * from './result';

export type Brand<K, T> = K & { readonly __brand: T };
export type Flavour<K, T> = K & { readonly __brand?: T };

export type DefaultRecord = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export type NonNullable<T> = T extends null | undefined ? never : T;

export const emmettPrefix = 'emt';

export const globalTag = 'global';
export const defaultTag = `${emmettPrefix}:default`;
export const unknownTag = `${emmettPrefix}:unknown`;
