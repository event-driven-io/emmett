import { createAction, createSlice, type PayloadAction, type UnknownAction } from '@reduxjs/toolkit';
import { assert, type Equals } from './_assert';

// Passing one type argument turns off inference for the rest: `.type` widens to string.
const incrementWide = createAction<number>('counter/increment');
assert<Equals<typeof incrementWide.type, string>>();
// The literal survives only when every type argument is spelled out.
const increment = createAction<number, 'counter/increment'>('counter/increment');
assert<Equals<typeof increment.type, 'counter/increment'>>();
type Increment = ReturnType<typeof increment>;
assert<Equals<Increment, { payload: number; type: 'counter/increment' }>>();
export const narrow = (action: UnknownAction) => (increment.match(action) ? action.payload : 0);

const counter = createSlice({
  name: 'counter',
  initialState: 0,
  reducers: { added: (state, action: PayloadAction<number>) => state + action.payload },
});
export const added = counter.actions.added(1);
assert<Equals<typeof added.type, 'counter/added'>>();
