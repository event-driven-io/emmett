// Every style's union types vs today's type-only definitions: mutual assignability (asserted)
// and strict identity (reported in results/strict-identity.txt).
import type { Decider } from '@event-driven-io/emmett';
import type * as Today from '../styles/today/shoppingCart';
import type * as TodayCmd from '../styles/today/businessLogic';
import type * as A from '../styles/a-builtin/shoppingCart';
import * as ACmd from '../styles/a-builtin/businessLogic';
import type * as B from '../styles/b-zod/shoppingCart';
import * as BCmd from '../styles/b-zod/businessLogic';
import type * as B2 from '../styles/b2-valibot/shoppingCart';
import * as B2Cmd from '../styles/b2-valibot/businessLogic';
import type * as B3 from '../styles/b3-arktype/shoppingCart';
import * as B3Cmd from '../styles/b3-arktype/businessLogic';
import type * as B4 from '../styles/b4-effect/shoppingCart';
import * as B4Cmd from '../styles/b4-effect/businessLogic';
import type * as B5 from '../styles/b5-typebox/shoppingCart';
import * as B5Cmd from '../styles/b5-typebox/businessLogic';
import type * as C from '../styles/c-type-first/shoppingCart';
import * as CCmd from '../styles/c-type-first/businessLogic';
import type * as D from '../styles/d-grouped/shoppingCart';
import * as DCmd from '../styles/d-grouped/businessLogic';
import type * as E from '../styles/e-interface/shoppingCart';
import * as ECmd from '../styles/e-interface/businessLogic';
import type * as F from '../styles/f-class/shoppingCart';
import * as FCmd from '../styles/f-class/businessLogic';

type Mutual<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const ok = <T extends true>() => {};

type Ev = Today.ShoppingCartEvent;
type Cm = TodayCmd.ShoppingCartCommand;
ok<Mutual<A.ShoppingCartEvent, Ev>>(); ok<Mutual<ACmd.ShoppingCartCommand, Cm>>();
ok<Mutual<B.ShoppingCartEvent, Ev>>(); ok<Mutual<BCmd.ShoppingCartCommand, Cm>>();
ok<Mutual<B2.ShoppingCartEvent, Ev>>(); ok<Mutual<B2Cmd.ShoppingCartCommand, Cm>>();
ok<Mutual<B3.ShoppingCartEvent, Ev>>(); ok<Mutual<B3Cmd.ShoppingCartCommand, Cm>>();
ok<Mutual<B4.ShoppingCartEvent, Ev>>(); ok<Mutual<B4Cmd.ShoppingCartCommand, Cm>>();
ok<Mutual<B5.ShoppingCartEvent, Ev>>(); ok<Mutual<B5Cmd.ShoppingCartCommand, Cm>>();
ok<Mutual<C.ShoppingCartEvent, Ev>>(); ok<Mutual<CCmd.ShoppingCartCommand, Cm>>();
ok<Mutual<D.ShoppingCartEvent, Ev>>(); ok<Mutual<DCmd.ShoppingCartCommand, Cm>>();
ok<Mutual<E.ShoppingCartEvent, Ev>>(); ok<Mutual<ECmd.ShoppingCartCommand, Cm>>();
// Class instances: mutual assignability checked below as F_reverse_assignable
ok<[F.ShoppingCartEvent] extends [Ev] ? true : false>();
ok<[FCmd.ShoppingCartCommand] extends [Cm] ? true : false>();

export type StrictIdentity = {
  A: [Equals<A.ShoppingCartEvent, Ev>, Equals<ACmd.ShoppingCartCommand, Cm>];
  B: [Equals<B.ShoppingCartEvent, Ev>, Equals<BCmd.ShoppingCartCommand, Cm>];
  B2: [Equals<B2.ShoppingCartEvent, Ev>, Equals<B2Cmd.ShoppingCartCommand, Cm>];
  B3: [Equals<B3.ShoppingCartEvent, Ev>, Equals<B3Cmd.ShoppingCartCommand, Cm>];
  B4: [Equals<B4.ShoppingCartEvent, Ev>, Equals<B4Cmd.ShoppingCartCommand, Cm>];
  B5: [Equals<B5.ShoppingCartEvent, Ev>, Equals<B5Cmd.ShoppingCartCommand, Cm>];
  C: [Equals<C.ShoppingCartEvent, Ev>, Equals<CCmd.ShoppingCartCommand, Cm>];
  D: [Equals<D.ShoppingCartEvent, Ev>, Equals<DCmd.ShoppingCartCommand, Cm>];
  E: [Equals<E.ShoppingCartEvent, Ev>, Equals<ECmd.ShoppingCartCommand, Cm>];
  F: [Equals<F.ShoppingCartEvent, Ev>, Equals<FCmd.ShoppingCartCommand, Cm>];
  F_reverse_assignable: [[Ev] extends [F.ShoppingCartEvent] ? true : false];
};

// Deciders built in any style plug into a Decider typed with today's types
export const deciders: Decider<Today.ShoppingCart, Cm, Ev>[] = [
  ACmd.decider, BCmd.decider, B2Cmd.decider, B3Cmd.decider, B4Cmd.decider,
  B5Cmd.decider, CCmd.decider, DCmd.decider, ECmd.decider,
];
