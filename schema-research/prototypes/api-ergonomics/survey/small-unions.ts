import { createAction as tsaCreateAction, type ActionType } from 'typesafe-actions';
import { ofType, unionize, type UnionOf } from 'unionize';
import { impl, matchExhaustive, type Variant } from '@practical-fp/union-types';
import { matchI, type ADT } from 'ts-adt';
import { assert, type Equals } from './_assert';

// typesafe-actions: one typeof over a module/object of creators
const actions = { add: tsaCreateAction('todos/ADD')<string>(), clear: tsaCreateAction('todos/CLEAR')() };
type TodosAction = ActionType<typeof actions>;
assert<Equals<TodosAction['type'], 'todos/ADD' | 'todos/CLEAR'>>();

// unionize: record of tags -> union + constructors + match
const Actions = unionize({ ADD_TODO: ofType<{ id: string; text: string }>(), CLEAR_TODOS: {} }, { tag: 'type', value: 'payload' });
type Action = UnionOf<typeof Actions>;
export const a: Action = Actions.ADD_TODO({ id: '1', text: 't' });
export const handled = Actions.match(a, { ADD_TODO: ({ text }) => text, CLEAR_TODOS: () => '' });

// @practical-fp/union-types: type first, constructors derived (Proxy)
type Shape = Variant<'Circle', { radius: number }> | Variant<'Square', { side: number }>;
const { Circle, Square } = impl<Shape>();
export const area = (s: Shape) => matchExhaustive(s, { Circle: ({ radius }) => radius ** 2, Square: ({ side }) => side ** 2 });
export const shapes: Shape[] = [Circle({ radius: 1 }), Square({ side: 2 })];

// ts-adt: type only, match helper
type Option = ADT<{ some: { value: string }; none: {} }>;
export const show = (o: Option) => matchI(o)({ some: ({ value }) => value, none: () => '' });
