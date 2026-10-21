// Ways to get a type name from a runtime definition. Each block compiles unless marked in errors/no-typeof.ts.
import type { DefaultRecord } from '@event-driven-io/emmett';
import { Event, s } from '../lib';

// 1. Baseline: phantom property
export const Confirmed1 = Event('Confirmed1', { data: { id: s.string() } });
export type Confirmed1 = typeof Confirmed1.Type;

// 2. Interface with the same name as the const, extending the inferred type.
//    Hover shows the interface name; still needs `typeof` once, inside `extends`.
export const Confirmed2 = Event('Confirmed2', { data: { id: s.string() } });
export interface Confirmed2 extends Event.Of<typeof Confirmed2> {}

// 3. Class: one declaration creates a value and a type. No `typeof`, but instances come from `new`.
const EventClass = <const T extends string, D extends DefaultRecord>(
  type: T,
  _data: { [K in keyof D]: { readonly Type: D[K] } },
) =>
  class {
    readonly type = type;
    readonly kind = 'Event' as const;
    constructor(readonly data: D) {}
  };
export class Confirmed3 extends EventClass('Confirmed3', { id: s.string() }) {}
export const instance3 = new Confirmed3({ id: '1' });
export const asEmmettEvent: Event<'Confirmed3', { id: string }> = instance3;

// 4. Function declaration + type alias with the same name (different declaration spaces).
//    Works, but the type is written by hand (type-first style).
export type Confirmed4 = Event<'Confirmed4', { id: string }>;
export const Confirmed4 = Event<Confirmed4>('Confirmed4', { data: { id: s.string() } });

// 5. Namespace merged with a function: the type lives at `Confirmed5.Type`, not at `Confirmed5`.
export function Confirmed5(data: { id: string }) {
  return { type: 'Confirmed5' as const, data };
}
export namespace Confirmed5 {
  export type Type = ReturnType<typeof Confirmed5>;
}
export const usesNamespace = (e: Confirmed5.Type) => e.data.id;

// 6. Typing a whole module at once: one `typeof` for many definitions, via a mapped type.
import * as defs from './no-typeof-defs';
type TypesOf<M> = { [K in keyof M as M[K] extends { readonly Type: unknown } ? K : never]: M[K] extends { readonly Type: infer T } ? T : never };
export type Defs = TypesOf<typeof defs>;
export const usesModuleMap = (e: Defs['Opened']) => e.data.cartId;
